import { sentinelComment, textToAdf } from '../core/adf';
import type { IssueRecord, ProjectInfo, SprintInfo } from '../core/types';
import type { Requester } from './http';
import { HttpError, paginateOffset, qs, request, requestJson, seg } from './http';
import type { FieldMap } from './mapper';
import { buildFieldMap, issueFields, mapIssue, mapSprint } from './mapper';

/** Thin Jira data access: every function takes a Requester so it works with asUser, asApp or the CLI. */

export const MAX_SPRINT_ISSUES = 300;

export async function getFieldMap(req: Requester): Promise<FieldMap> {
  const fields = await requestJson<Array<{ id: string; name: string; schema?: { custom?: string } }>>(req, '/rest/api/3/field');
  return buildFieldMap(fields);
}

export async function getProject(req: Requester, projectKey: string): Promise<ProjectInfo & { id: string; simplified: boolean }> {
  const p = await requestJson<{ id: string; key: string; name: string; simplified?: boolean; style?: string }>(req, `/rest/api/3/project/${seg(projectKey)}`);
  return { id: p.id, key: p.key, name: p.name, simplified: p.simplified === true || p.style === 'next-gen' };
}

export interface Board {
  id: number;
  name: string;
  type: string;
}

export async function findBoards(req: Requester, projectKey: string): Promise<Board[]> {
  return paginateOffset<Board>(
    req,
    (startAt) => `/rest/agile/1.0/board${qs({ projectKeyOrId: projectKey, startAt, maxResults: 50 })}`,
    (page) => (Array.isArray(page.values) ? (page.values as Board[]) : []),
    200,
  );
}

export async function listSprints(req: Requester, boardId: number, states = 'active,future,closed'): Promise<SprintInfo[]> {
  const raw = await paginateOffset<unknown>(
    req,
    (startAt) => `/rest/agile/1.0/board/${seg(boardId)}/sprint${qs({ state: states, startAt, maxResults: 50 })}`,
    (page) => (Array.isArray(page.values) ? page.values : []),
    500,
  );
  return raw.map(mapSprint);
}

export async function getSprint(req: Requester, sprintId: number): Promise<SprintInfo> {
  return mapSprint(await requestJson(req, `/rest/agile/1.0/sprint/${seg(sprintId)}`));
}

export interface SprintChoice {
  sprint: SprintInfo | null;
  sprints: SprintInfo[];
  boards: Board[];
  reason?: string;
}

/** Sprints across the project's scrum boards; picks the requested one, else the active one, else the next future one. */
export async function resolveSprint(req: Requester, projectKey: string, sprintId?: number): Promise<SprintChoice> {
  const boards = (await findBoards(req, projectKey)).filter((b) => b.type === 'scrum');
  const seen = new Map<number, SprintInfo>();
  for (const b of boards) {
    try {
      for (const s of await listSprints(req, b.id)) if (!seen.has(s.id)) seen.set(s.id, { ...s, boardId: s.boardId ?? b.id });
    } catch (e) {
      // Boards that do not support sprints return 400; skip them.
      if (!(e instanceof HttpError) || e.status !== 400) throw e;
    }
  }
  const order = { active: 0, future: 1, closed: 2 } as const;
  const sprints = [...seen.values()].sort((a, b) => order[a.state] - order[b.state] || (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.id - a.id);
  if (sprintId !== undefined) {
    const found = seen.get(sprintId) ?? (await getSprint(req, sprintId).catch(() => null));
    return found ? { sprint: found, sprints, boards } : { sprint: null, sprints, boards, reason: `Sprint ${sprintId} was not found or you cannot see it.` };
  }
  if (!boards.length) return { sprint: null, sprints, boards, reason: `Project ${projectKey} has no Scrum board, so there are no sprints to analyse.` };
  const active = sprints.find((s) => s.state === 'active');
  if (active) return { sprint: active, sprints, boards };
  const future = sprints.filter((s) => s.state === 'future').sort((a, b) => a.id - b.id)[0];
  if (future) return { sprint: future, sprints, boards, reason: 'No active sprint; analysing the next planned sprint.' };
  return { sprint: null, sprints, boards, reason: `Project ${projectKey} has no active or planned sprint.` };
}

export interface SprintIssues {
  issues: IssueRecord[];
  notes: string[];
}

/** All issues in a sprint with changelog, comments and links, using the enhanced JQL search with token pagination. */
export async function fetchSprintIssues(req: Requester, sprintId: number, map: FieldMap, maxIssues = MAX_SPRINT_ISSUES): Promise<SprintIssues> {
  const issues: IssueRecord[] = [];
  let truncatedChangelogs = 0;
  let nextPageToken: string | undefined;
  for (;;) {
    const page = await requestJson<{ issues?: unknown[]; nextPageToken?: string; isLast?: boolean }>(req, '/rest/api/3/search/jql', {
      method: 'POST',
      body: {
        jql: `sprint = ${Number(sprintId)} ORDER BY rank ASC`,
        fields: issueFields(map),
        expand: 'changelog',
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    });
    for (const raw of page.issues ?? []) {
      const { issue, changelogTruncated } = mapIssue(raw, map, sprintId);
      issues.push(issue);
      if (changelogTruncated) truncatedChangelogs++;
    }
    nextPageToken = page.nextPageToken;
    if (!nextPageToken || page.isLast === true || issues.length >= maxIssues || !(page.issues ?? []).length) break;
  }
  const notes: string[] = [];
  if (issues.length >= maxIssues) notes.push(`Only the first ${maxIssues} issues of the sprint were analysed.`);
  if (truncatedChangelogs) notes.push(`Changelog history was truncated on ${truncatedChangelogs} issue(s); their sprint-add dates use the newest available entry.`);
  return { issues: issues.slice(0, maxIssues), notes };
}

export async function getIssueBasics(req: Requester, issueKey: string, map?: FieldMap): Promise<{
  key: string;
  summary: string;
  projectKey: string;
  labels: string[];
  sprintIds: number[];
  flagged: boolean;
  status: string;
}> {
  const fields = ['summary', 'project', 'labels', 'status', ...(map?.sprint ? [map.sprint] : []), ...(map?.flagged ? [map.flagged] : [])];
  const r = await requestJson<{ key: string; fields: Record<string, unknown> }>(req, `/rest/api/3/issue/${seg(issueKey)}${qs({ fields: fields.join(',') })}`);
  const sprintVal = map?.sprint ? r.fields[map.sprint] : undefined;
  const sprints = Array.isArray(sprintVal) ? (sprintVal as Array<{ id?: number; state?: string }>) : [];
  const flaggedVal = map?.flagged ? r.fields[map.flagged] : undefined;
  return {
    key: r.key,
    summary: String(r.fields.summary ?? ''),
    projectKey: String((r.fields.project as { key?: string } | undefined)?.key ?? issueKey.split('-')[0]),
    labels: Array.isArray(r.fields.labels) ? (r.fields.labels as string[]) : [],
    // Active sprints first so callers can pick the current one.
    sprintIds: [...sprints].sort((a, b) => (a.state === 'active' ? -1 : 0) - (b.state === 'active' ? -1 : 0)).map((s) => Number(s.id)).filter(Boolean),
    flagged: Array.isArray(flaggedVal) ? flaggedVal.length > 0 : !!flaggedVal,
    status: String((r.fields.status as { name?: string } | undefined)?.name ?? ''),
  };
}

// ---------- Write operations (only ever called after a verified confirmation) ----------

export async function addComment(req: Requester, issueKey: string, text: string): Promise<{ id: string }> {
  return requestJson<{ id: string }>(req, `/rest/api/3/issue/${seg(issueKey)}/comment`, { method: 'POST', body: { body: sentinelComment(text) } });
}

export async function addLabel(req: Requester, issueKey: string, label: string): Promise<void> {
  await requestJson(req, `/rest/api/3/issue/${seg(issueKey)}`, { method: 'PUT', body: { update: { labels: [{ add: label }] } } });
}

export async function setFlag(req: Requester, issueKey: string, map: FieldMap, on = true): Promise<void> {
  if (!map.flagged) throw new Error('This Jira site has no "Flagged" field, so the issue cannot be flagged.');
  await requestJson(req, `/rest/api/3/issue/${seg(issueKey)}`, {
    method: 'PUT',
    body: { fields: { [map.flagged]: on ? [{ value: 'Impediment' }] : [] } },
  });
}

export interface IssueTypeMeta {
  id: string;
  name: string;
  subtask: boolean;
  hierarchyLevel?: number;
}

export async function getProjectIssueTypes(req: Requester, projectKey: string): Promise<IssueTypeMeta[]> {
  return paginateOffset<IssueTypeMeta>(
    req,
    (startAt) => `/rest/api/3/issue/createmeta/${seg(projectKey)}/issuetypes${qs({ startAt, maxResults: 50 })}`,
    (page) => ((page.issueTypes ?? page.values ?? []) as IssueTypeMeta[]),
    200,
  );
}

export async function getCreateFieldIds(req: Requester, projectKey: string, issueTypeId: string): Promise<Set<string>> {
  const fields = await paginateOffset<{ fieldId: string }>(
    req,
    (startAt) => `/rest/api/3/issue/createmeta/${seg(projectKey)}/issuetypes/${seg(issueTypeId)}${qs({ startAt, maxResults: 100 })}`,
    (page) => ((page.fields ?? page.values ?? []) as Array<{ fieldId: string }>),
    500,
  );
  return new Set(fields.map((f) => f.fieldId));
}

export async function createSubtask(
  req: Requester,
  parentKey: string,
  summary: string,
  description: string,
): Promise<{ key: string; id: string }> {
  const projectKey = parentKey.split('-')[0] as string;
  const types = await getProjectIssueTypes(req, projectKey);
  const sub = types.find((t) => t.subtask);
  if (!sub) throw new Error(`Project ${projectKey} has no sub-task issue type.`);
  return requestJson<{ key: string; id: string }>(req, '/rest/api/3/issue', {
    method: 'POST',
    body: {
      fields: {
        project: { key: projectKey },
        parent: { key: parentKey },
        issuetype: { id: sub.id },
        summary,
        description: textToAdf(`${description}\n\nCreated by Sprint Sentinel after user confirmation.`),
        labels: ['sentinel-followup'],
      },
    },
  });
}

/** Does the current user exist / can we reach Jira? Used for health checks. */
export async function ping(req: Requester): Promise<boolean> {
  const res = await request(req, '/rest/api/3/myself');
  return res.ok;
}
