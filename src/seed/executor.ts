import { textToAdf } from '../core/adf';
import type { Requester } from '../jira/http';
import { HttpError, qs, request, requestJson, seg } from '../jira/http';
import { buildFieldMap, mapLinks } from '../jira/mapper';
import { findBoards, getCreateFieldIds, getProjectIssueTypes } from '../jira/service';
import type { SeedIssue, SeedStatus } from './dataset';
import { SEED_ISSUES, SEED_LABEL, SEED_LINKS, SEED_SPRINT_GOAL, SEED_SPRINT_NAME, SEED_SUBTASKS, dueDate } from './dataset';

/**
 * Resumable, step-wise demo-data seeder. Each call to `runNextStep` does a bounded amount of work
 * (so it fits inside a Forge resolver invocation) and returns the updated state, which the caller
 * persists and passes back in. Works with any Requester: Forge asUser (UI button) or the local CLI.
 */

export const STEPS = ['prepare', 'issues', 'subtasks', 'links', 'sprint', 'creep', 'workflow', 'comments'] as const;
export type StepName = (typeof STEPS)[number];

export interface SeedState {
  projectKey: string;
  step: number;
  cursor: number;
  done: boolean;
  startedAt: string;
  boardId?: number;
  sprintId?: number;
  typeIds: { Story?: string; Task?: string; Bug?: string; Subtask?: string };
  pointsField?: string;
  dueSupported: boolean;
  flaggedField?: string;
  linkTypeName?: string;
  /** true => {inwardIssue: blocker, outwardIssue: blocked} produces "blocker blocks blocked". */
  linkInwardIsBlocker?: boolean;
  users: string[];
  keys: Record<string, string>;
  subtaskKeys: Array<{ key: string; status: SeedStatus }>;
  log: string[];
}

export function initialState(projectKey: string, now: Date): SeedState {
  return { projectKey, step: 0, cursor: 0, done: false, startedAt: now.toISOString(), typeIds: {}, dueSupported: true, users: [], keys: {}, subtaskKeys: [], log: [] };
}

export interface StepResult {
  state: SeedState;
  progress: number; // 0..1
  message: string;
}

const BATCH = 8;

function typeIdFor(state: SeedState, t: SeedIssue['type']): string {
  const id = state.typeIds[t] ?? state.typeIds.Task ?? state.typeIds.Story;
  if (!id) throw new Error('No usable issue type (Story/Task) in this project.');
  return id;
}

export function issueFieldsFor(s: SeedIssue, state: SeedState, seedDay: Date, withOptional = true): Record<string, unknown> {
  const user = s.assignee === null || !state.users.length ? null : state.users[s.assignee % state.users.length];
  return {
    project: { key: state.projectKey },
    issuetype: { id: typeIdFor(state, s.type) },
    summary: s.summary,
    description: textToAdf(s.description),
    labels: [SEED_LABEL],
    ...(user ? { assignee: { accountId: user } } : {}),
    ...(withOptional && state.pointsField && s.points !== undefined ? { [state.pointsField]: s.points } : {}),
    ...(withOptional && state.dueSupported && s.dueInDays !== undefined ? { duedate: dueDate(seedDay, s.dueInDays) } : {}),
  };
}

interface BulkResponse {
  issues?: Array<{ id: string; key: string }>;
  errors?: Array<{ failedElementNumber: number; elementErrors?: { errors?: Record<string, string>; errorMessages?: string[] } }>;
}

/** Bulk-create issues; failed elements are retried one by one without optional fields. Returns keys in input order. */
export async function bulkCreate(req: Requester, payloads: Array<{ full: Record<string, unknown>; minimal: Record<string, unknown> }>): Promise<string[]> {
  const res = await requestJson<BulkResponse>(req, '/rest/api/3/issue/bulk', { method: 'POST', body: { issueUpdates: payloads.map((p) => ({ fields: p.full })) } }).catch(
    (e: unknown) => {
      // Jira returns 400 when *every* element fails; treat that as all-failed.
      if (e instanceof HttpError && e.status === 400) return { issues: [], errors: payloads.map((_, i) => ({ failedElementNumber: i })) } as BulkResponse;
      throw e;
    },
  );
  const failed = new Set((res.errors ?? []).map((e) => e.failedElementNumber));
  const created = [...(res.issues ?? [])];
  const keys: string[] = [];
  for (let i = 0; i < payloads.length; i++) {
    if (!failed.has(i)) {
      const next = created.shift();
      if (!next) throw new Error('Bulk create returned fewer issues than expected.');
      keys.push(next.key);
    } else {
      const one = await requestJson<{ key: string }>(req, '/rest/api/3/issue', { method: 'POST', body: { fields: (payloads[i] as { minimal: Record<string, unknown> }).minimal } });
      keys.push(one.key);
    }
  }
  return keys;
}

async function transitionTo(req: Requester, key: string, target: 'indeterminate' | 'done'): Promise<boolean> {
  for (let hop = 0; hop < 2; hop++) {
    const t = await requestJson<{ transitions: Array<{ id: string; to: { statusCategory?: { key?: string } } }> }>(req, `/rest/api/3/issue/${seg(key)}/transitions`);
    const direct = t.transitions.find((x) => x.to.statusCategory?.key === target);
    const via = t.transitions.find((x) => x.to.statusCategory?.key === 'indeterminate');
    const pick = direct ?? (target === 'done' ? via : undefined);
    if (!pick) return false;
    await requestJson(req, `/rest/api/3/issue/${seg(key)}/transitions`, { method: 'POST', body: { transition: { id: pick.id } } });
    if (pick === direct) return true;
  }
  return false;
}

async function addLink(req: Requester, typeName: string, blocker: string, blocked: string, inwardIsBlocker: boolean): Promise<void> {
  const body = inwardIsBlocker
    ? { type: { name: typeName }, inwardIssue: { key: blocker }, outwardIssue: { key: blocked } }
    : { type: { name: typeName }, inwardIssue: { key: blocked }, outwardIssue: { key: blocker } };
  await requestJson(req, '/rest/api/3/issueLink', { method: 'POST', body });
}

async function prepare(req: Requester, state: SeedState): Promise<string> {
  const existing = await requestJson<{ issues?: unknown[] }>(req, '/rest/api/3/search/jql', {
    method: 'POST',
    body: { jql: `project = "${state.projectKey}" AND labels = "${SEED_LABEL}"`, maxResults: 1, fields: ['summary'] },
  });
  if ((existing.issues ?? []).length) throw new Error(`Project ${state.projectKey} already contains demo issues (label "${SEED_LABEL}"). Use a fresh Scrum project.`);

  const boards = (await findBoards(req, state.projectKey)).filter((b) => b.type === 'scrum');
  const board = boards[0];
  if (!board) throw new Error(`Project ${state.projectKey} has no Scrum board. Create the project from the Scrum template.`);
  state.boardId = board.id;
  const active = await requestJson<{ values?: Array<{ name: string }> }>(req, `/rest/agile/1.0/board/${seg(board.id)}/sprint${qs({ state: 'active' })}`);
  if ((active.values ?? []).length) throw new Error(`Board "${board.name}" already has an active sprint ("${active.values?.[0]?.name}"). Complete it or use a fresh Scrum project.`);

  const types = await getProjectIssueTypes(req, state.projectKey);
  const find = (names: string[]) => types.find((t) => !t.subtask && names.includes(t.name.toLowerCase()))?.id;
  state.typeIds = {
    ...(find(['story']) ? { Story: find(['story']) as string } : {}),
    ...(find(['task']) ? { Task: find(['task']) as string } : {}),
    ...(find(['bug']) ? { Bug: find(['bug']) as string } : {}),
    ...(types.find((t) => t.subtask)?.id ? { Subtask: types.find((t) => t.subtask)?.id as string } : {}),
  };
  if (!state.typeIds.Story && !state.typeIds.Task) throw new Error('Project has neither a Story nor a Task issue type.');

  const fieldMap = buildFieldMap(await requestJson(req, '/rest/api/3/field'));
  const createFields = await getCreateFieldIds(req, state.projectKey, (state.typeIds.Story ?? state.typeIds.Task) as string);
  state.pointsField = fieldMap.storyPoints.find((id) => createFields.has(id));
  state.dueSupported = createFields.has('duedate');
  if (fieldMap.flagged) state.flaggedField = fieldMap.flagged;

  const linkTypes = await requestJson<{ issueLinkTypes: Array<{ name: string; inward: string }> }>(req, '/rest/api/3/issueLinkType');
  state.linkTypeName = linkTypes.issueLinkTypes.find((t) => t.name.toLowerCase() === 'blocks' || t.inward.toLowerCase().includes('blocked by'))?.name;

  const users = await requestJson<Array<{ accountId: string; accountType?: string; active?: boolean }>>(
    req,
    `/rest/api/3/user/assignable/search${qs({ project: state.projectKey, maxResults: 50 })}`,
  );
  state.users = users.filter((u) => (u.accountType ?? 'atlassian') === 'atlassian' && u.active !== false).map((u) => u.accountId).slice(0, 4);
  return `Found board #${board.id}, ${state.users.length} assignable people${state.pointsField ? ', story points' : ''}${state.dueSupported ? ', due dates' : ''}.`;
}

export async function runNextStep(req: Requester, state: SeedState, now: Date): Promise<StepResult> {
  const s: SeedState = structuredClone(state);
  if (s.done) return { state: s, progress: 1, message: 'Demo data already created.' };
  const name = STEPS[s.step] as StepName;
  let message = '';
  let advance = true;
  const seedDay = new Date(s.startedAt);
  const sprintIssues = SEED_ISSUES.filter((i) => i.phase !== 'backlog');

  switch (name) {
    case 'prepare':
      message = await prepare(req, s);
      break;
    case 'issues': {
      const todo = SEED_ISSUES.filter((i) => !s.keys[i.ref]);
      const payloads = todo.map((i) => ({ full: issueFieldsFor(i, s, seedDay, true), minimal: issueFieldsFor(i, s, seedDay, false) }));
      const keys = await bulkCreate(req, payloads);
      todo.forEach((i, n) => (s.keys[i.ref] = keys[n] as string));
      message = `Created ${keys.length} issues.`;
      break;
    }
    case 'subtasks': {
      if (!s.typeIds.Subtask) {
        message = 'Project has no sub-task type; skipped sub-tasks.';
        break;
      }
      const payloads = SEED_SUBTASKS.map((st) => {
        const f = {
          project: { key: s.projectKey },
          parent: { key: s.keys[st.parent] },
          issuetype: { id: s.typeIds.Subtask },
          summary: st.summary,
          labels: [SEED_LABEL],
          ...(s.users[0] ? { assignee: { accountId: s.users[0] } } : {}),
        };
        return { full: f, minimal: f };
      });
      const keys = await bulkCreate(req, payloads);
      s.subtaskKeys = keys.map((key, n) => ({ key, status: (SEED_SUBTASKS[n] as { status: SeedStatus }).status }));
      message = `Created ${keys.length} sub-tasks.`;
      break;
    }
    case 'links': {
      if (!s.linkTypeName) {
        message = 'No "Blocks" link type on this site; skipped dependencies.';
        break;
      }
      const pending = SEED_LINKS.slice(s.cursor, s.cursor + BATCH);
      for (const [blocker, blocked] of pending) {
        const a = s.keys[blocker] as string;
        const b = s.keys[blocked] as string;
        if (s.linkInwardIsBlocker === undefined) {
          await addLink(req, s.linkTypeName, a, b, true);
          const check = await requestJson<{ fields: { issuelinks?: Array<{ id: string }> } }>(req, `/rest/api/3/issue/${seg(a)}${qs({ fields: 'issuelinks' })}`);
          const rel = mapLinks(check.fields.issuelinks).find((l) => l.key === b)?.relation;
          s.linkInwardIsBlocker = rel === 'blocks';
          if (!s.linkInwardIsBlocker) {
            const raw = (check.fields.issuelinks ?? []) as Array<{ id: string; inwardIssue?: { key: string }; outwardIssue?: { key: string } }>;
            const wrong = raw.find((l) => l.inwardIssue?.key === b || l.outwardIssue?.key === b);
            if (wrong) await request(req, `/rest/api/3/issueLink/${seg(wrong.id)}`, { method: 'DELETE' });
            await addLink(req, s.linkTypeName, a, b, false);
          }
        } else {
          await addLink(req, s.linkTypeName, a, b, s.linkInwardIsBlocker);
        }
      }
      s.cursor += pending.length;
      advance = s.cursor >= SEED_LINKS.length;
      message = `Linked ${s.cursor}/${SEED_LINKS.length} dependencies.`;
      break;
    }
    case 'sprint': {
      const sprint = await requestJson<{ id: number }>(req, '/rest/agile/1.0/sprint', {
        method: 'POST',
        body: { name: SEED_SPRINT_NAME, originBoardId: s.boardId, goal: SEED_SPRINT_GOAL },
      });
      s.sprintId = sprint.id;
      const committed = sprintIssues.filter((i) => i.phase === 'committed').map((i) => s.keys[i.ref] as string);
      await requestJson(req, `/rest/agile/1.0/sprint/${seg(sprint.id)}/issue`, { method: 'POST', body: { issues: committed } });
      const start = new Date(now.getTime() - 60_000);
      const end = new Date(start.getTime() + 10 * 86_400_000);
      await requestJson(req, `/rest/agile/1.0/sprint/${seg(sprint.id)}`, { method: 'POST', body: { state: 'active', startDate: start.toISOString(), endDate: end.toISOString() } });
      message = `Started sprint "${SEED_SPRINT_NAME}" with ${committed.length} committed issues.`;
      break;
    }
    case 'creep': {
      const creep = sprintIssues.filter((i) => i.phase === 'creep').map((i) => s.keys[i.ref] as string);
      await requestJson(req, `/rest/agile/1.0/sprint/${seg(s.sprintId as number)}/issue`, { method: 'POST', body: { issues: creep } });
      message = `Added ${creep.length} issues after the sprint started (scope creep).`;
      break;
    }
    case 'workflow': {
      const targets: Array<{ key: string; status: SeedStatus }> = [
        ...SEED_ISSUES.filter((i) => i.status !== 'todo').map((i) => ({ key: s.keys[i.ref] as string, status: i.status })),
        ...s.subtaskKeys.filter((st) => st.status !== 'todo'),
      ];
      const batch = targets.slice(s.cursor, s.cursor + BATCH);
      for (const t of batch) await transitionTo(req, t.key, t.status === 'done' ? 'done' : 'indeterminate');
      s.cursor += batch.length;
      advance = s.cursor >= targets.length;
      message = `Moved ${s.cursor}/${targets.length} issues through the workflow.`;
      break;
    }
    case 'comments': {
      let comments = 0;
      for (const i of SEED_ISSUES) {
        for (const c of i.comments ?? []) {
          await requestJson(req, `/rest/api/3/issue/${seg(s.keys[i.ref] as string)}/comment`, { method: 'POST', body: { body: textToAdf(c) } });
          comments++;
        }
        if (i.flagged && s.flaggedField) {
          await requestJson(req, `/rest/api/3/issue/${seg(s.keys[i.ref] as string)}`, {
            method: 'PUT',
            body: { fields: { [s.flaggedField]: [{ value: 'Impediment' }] } },
          }).catch(() => undefined);
        }
      }
      message = `Added ${comments} comments and flagged impediments.`;
      break;
    }
  }

  s.log.push(`${name}: ${message}`);
  if (advance) {
    s.step += 1;
    s.cursor = 0;
  }
  s.done = s.step >= STEPS.length;
  const progress = Math.min(1, (s.step + (advance ? 0 : 0.5)) / STEPS.length);
  return { state: s, progress, message: s.done ? `Done. ${message}` : message };
}
