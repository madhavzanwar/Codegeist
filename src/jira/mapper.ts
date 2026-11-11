import { adfHasTaskList, adfToText } from '../core/adf';
import type { CommentRecord, IssueRecord, LinkRecord, Person, SprintInfo, StatusCategory } from '../core/types';

/** Pure mapping from Jira REST JSON to domain records. */

export interface FieldMap {
  storyPoints: string[]; // candidate custom field ids, in priority order
  flagged?: string;
  sprint?: string;
}

interface RawField {
  id: string;
  name: string;
  schema?: { custom?: string; type?: string };
}

export function buildFieldMap(fields: RawField[]): FieldMap {
  const byName = (names: string[]) => fields.filter((f) => names.includes(f.name.toLowerCase())).map((f) => f.id);
  const storyPoints = [...byName(['story point estimate']), ...byName(['story points']), ...byName(['story point'])];
  const flagged = fields.find((f) => f.name.toLowerCase() === 'flagged')?.id;
  const sprint =
    fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id ?? fields.find((f) => f.name.toLowerCase() === 'sprint')?.id;
  return { storyPoints: [...new Set(storyPoints)], ...(flagged ? { flagged } : {}), ...(sprint ? { sprint } : {}) };
}

export function issueFields(map: FieldMap): string[] {
  return [
    'summary',
    'status',
    'issuetype',
    'priority',
    'assignee',
    'reporter',
    'created',
    'updated',
    'duedate',
    'resolutiondate',
    'statuscategorychangedate',
    'labels',
    'description',
    'comment',
    'issuelinks',
    'parent',
    ...map.storyPoints,
    ...(map.flagged ? [map.flagged] : []),
    ...(map.sprint ? [map.sprint] : []),
  ];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function toPerson(v: unknown): Person | null {
  const o = obj(v);
  const accountId = str(o.accountId);
  return accountId ? { accountId, displayName: str(o.displayName) ?? 'Unknown user' } : null;
}

export function toStatusCategory(status: unknown): StatusCategory {
  const key = str(obj(obj(status).statusCategory).key);
  if (key === 'done') return 'done';
  if (key === 'indeterminate') return 'indeterminate';
  return 'new';
}

function isBlocksType(type: Json): boolean {
  const name = (str(type.name) ?? '').toLowerCase();
  const inward = (str(type.inward) ?? '').toLowerCase();
  return name === 'blocks' || name === 'blocker' || inward.includes('blocked by');
}

export function mapLinks(raw: unknown): LinkRecord[] {
  const out: LinkRecord[] = [];
  for (const l of Array.isArray(raw) ? raw : []) {
    const link = obj(l);
    if (!isBlocksType(obj(link.type))) continue;
    const inward = obj(link.inwardIssue);
    const outward = obj(link.outwardIssue);
    // On issue X: an `inwardIssue` Y renders as "X is blocked by Y"; an `outwardIssue` Y renders as "X blocks Y".
    const other = str(inward.key) ? inward : outward;
    const key = str(other.key);
    if (!key) continue;
    const fields = obj(other.fields);
    out.push({
      relation: str(inward.key) ? 'blockedBy' : 'blocks',
      key,
      ...(str(fields.summary) ? { summary: str(fields.summary) as string } : {}),
      statusCategory: toStatusCategory(fields.status),
    });
  }
  return out;
}

export function mapComments(raw: unknown): { comments: CommentRecord[]; total: number } {
  const c = obj(raw);
  const list = Array.isArray(c.comments) ? c.comments : [];
  const comments = list.map((x) => {
    const o = obj(x);
    return { id: str(o.id) ?? '', author: toPerson(o.author), created: str(o.created) ?? '', text: adfToText(o.body).trim() };
  });
  return { comments, total: typeof c.total === 'number' ? c.total : comments.length };
}

function sprintIdsFrom(value: string | undefined | null): number[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * When was the issue (last) added to `sprintId`? Uses the changelog "Sprint" field.
 * Returns { at, available, truncated }.
 */
export function addedToSprintAt(changelog: unknown, sprintId: number, created: string): { at?: string; available: boolean; truncated: boolean } {
  const cl = obj(changelog);
  const histories = Array.isArray(cl.histories) ? cl.histories : null;
  if (!histories) return { available: false, truncated: false };
  const truncated = typeof cl.total === 'number' && cl.total > histories.length;
  let at: string | undefined;
  for (const h of histories) {
    const ho = obj(h);
    for (const it of Array.isArray(ho.items) ? ho.items : []) {
      const item = obj(it);
      if ((str(item.field) ?? '').toLowerCase() !== 'sprint') continue;
      const from = sprintIdsFrom(str(item.from));
      const to = sprintIdsFrom(str(item.to));
      if (to.includes(sprintId) && !from.includes(sprintId)) {
        const created = str(ho.created);
        if (created && (!at || created > at)) at = created;
      }
    }
  }
  // No "added" entry: the issue was created directly in the sprint (or the entry was truncated away).
  return { at: at ?? created, available: true, truncated };
}

export function mapIssue(raw: unknown, map: FieldMap, sprintId: number): { issue: IssueRecord; changelogTruncated: boolean } {
  const r = obj(raw);
  const f = obj(r.fields);
  const issueType = obj(f.issuetype);
  const created = str(f.created) ?? '';
  const sp = map.storyPoints.map((id) => f[id]).find((v) => typeof v === 'number') as number | undefined;
  const flaggedVal = map.flagged ? f[map.flagged] : undefined;
  const { comments, total } = mapComments(f.comment);
  const added = addedToSprintAt(r.changelog, sprintId, created);
  const issue: IssueRecord = {
    key: str(r.key) ?? '',
    id: str(r.id) ?? '',
    summary: str(f.summary) ?? '',
    issueType: str(issueType.name) ?? 'Unknown',
    isSubtask: issueType.subtask === true,
    ...(str(obj(f.parent).key) ? { parentKey: str(obj(f.parent).key) as string } : {}),
    status: str(obj(f.status).name) ?? 'Unknown',
    statusCategory: toStatusCategory(f.status),
    ...(str(obj(f.priority).name) ? { priority: str(obj(f.priority).name) as string } : {}),
    assignee: toPerson(f.assignee),
    reporter: toPerson(f.reporter),
    created,
    updated: str(f.updated) ?? created,
    ...(str(f.statuscategorychangedate) ? { statusCategoryChangedAt: str(f.statuscategorychangedate) as string } : {}),
    ...(str(f.duedate) ? { dueDate: str(f.duedate) as string } : {}),
    ...(str(f.resolutiondate) ? { resolutionDate: str(f.resolutiondate) as string } : {}),
    ...(sp !== undefined ? { storyPoints: sp } : {}),
    labels: Array.isArray(f.labels) ? (f.labels.filter((l) => typeof l === 'string') as string[]) : [],
    flagged: Array.isArray(flaggedVal) ? flaggedVal.length > 0 : !!flaggedVal,
    descriptionText: adfToText(f.description).trim(),
    hasChecklist: adfHasTaskList(f.description),
    comments,
    commentsTotal: total,
    links: mapLinks(f.issuelinks),
    ...(added.at ? { addedToSprintAt: added.at } : {}),
    changelogAvailable: added.available,
  };
  return { issue, changelogTruncated: added.truncated };
}

export function mapSprint(raw: unknown): SprintInfo {
  const s = obj(raw);
  const state = str(s.state);
  return {
    id: Number(s.id),
    name: str(s.name) ?? `Sprint ${String(s.id)}`,
    state: state === 'active' || state === 'closed' ? state : 'future',
    ...(str(s.startDate) ? { startDate: str(s.startDate) as string } : {}),
    ...(str(s.endDate) ? { endDate: str(s.endDate) as string } : {}),
    ...(str(s.activatedDate) ? { activatedDate: str(s.activatedDate) as string } : {}),
    ...(str(s.completeDate) ? { completeDate: str(s.completeDate) as string } : {}),
    ...(str(s.goal) ? { goal: str(s.goal) as string } : {}),
    ...(typeof s.originBoardId === 'number' ? { boardId: s.originBoardId } : {}),
  };
}
