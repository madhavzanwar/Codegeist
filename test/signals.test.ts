import { describe, expect, it } from 'vitest';
import { buildBlockerGraph } from '../src/core/graph';
import type { DetectorContext } from '../src/core/signals';
import {
  computeAssigneeLoad,
  detectBlocked,
  detectBlockerChains,
  detectDueDates,
  detectMissingAcceptanceCriteria,
  detectOverload,
  detectScopeCreep,
  detectStale,
  detectUnansweredQuestion,
  detectUnassigned,
  scopeStatus,
} from '../src/core/signals';
import { DEFAULT_SETTINGS } from '../src/core/types';
import type { IssueRecord } from '../src/core/types';
import { NOW, alice, bob, cara, issue, sprint } from './fixtures';

function ctx(issues: IssueRecord[], overrides: Partial<DetectorContext> = {}): DetectorContext {
  return {
    now: NOW,
    sprint,
    settings: DEFAULT_SETTINGS,
    graph: buildBlockerGraph(issues),
    byKey: new Map(issues.map((i) => [i.key, i])),
    ...overrides,
  };
}

describe('detectBlocked', () => {
  it('flags issues blocked by unresolved issues with evidence', () => {
    const a = issue({ key: 'D-1', links: [{ relation: 'blockedBy', key: 'D-2', statusCategory: 'indeterminate' }] });
    const b = issue({ key: 'D-2', statusCategory: 'indeterminate' });
    const [s] = detectBlocked(a, ctx([a, b]));
    expect(s?.kind).toBe('blocked');
    expect(s?.points).toBe(35);
    expect(s?.evidence.map((e) => e.value)).toContain('D-2');
    expect(s?.message).toContain('blocked by 1 unresolved issue (D-2)');
  });

  it('adds weight when the blocker is outside the sprint', () => {
    const a = issue({ key: 'D-1', links: [{ relation: 'blockedBy', key: 'OPS-9', statusCategory: 'new' }] });
    const [s] = detectBlocked(a, ctx([a]));
    expect(s?.points).toBe(45);
    expect(s?.severity).toBe('high');
    expect(s?.message).toContain('outside this sprint');
  });

  it('ignores resolved blockers and done issues', () => {
    const a = issue({ key: 'D-1', links: [{ relation: 'blockedBy', key: 'D-2', statusCategory: 'done' }] });
    const b = issue({ key: 'D-2', statusCategory: 'done' });
    expect(detectBlocked(a, ctx([a, b]))).toEqual([]);
    const done = issue({ key: 'D-3', statusCategory: 'done', flagged: true });
    expect(detectBlocked(done, ctx([done]))).toEqual([]);
  });

  it('treats the Flagged field as an impediment', () => {
    const a = issue({ key: 'D-1', flagged: true });
    const [s] = detectBlocked(a, ctx([a]));
    expect(s?.message).toContain('flagged as an impediment');
    expect(s?.severity).toBe('medium');
  });
});

describe('detectBlockerChains', () => {
  it('finds a maximal chain and the keystone blocker', () => {
    // D-1 blocks D-2 blocks D-3; D-1 also blocks D-4
    const i1 = issue({ key: 'D-1', statusCategory: 'indeterminate', links: [
      { relation: 'blocks', key: 'D-2', statusCategory: 'new' },
      { relation: 'blocks', key: 'D-4', statusCategory: 'new' },
    ] });
    const i2 = issue({ key: 'D-2', links: [{ relation: 'blocks', key: 'D-3', statusCategory: 'new' }] });
    const i3 = issue({ key: 'D-3' });
    const i4 = issue({ key: 'D-4' });
    const res = detectBlockerChains(ctx([i1, i2, i3, i4]));
    expect(res.chains).toEqual([['D-1', 'D-2', 'D-3']]);
    expect(res.cycles).toEqual([]);
    const keystone = res.signals.find((s) => s.issueKey === 'D-1');
    expect(keystone?.message).toContain('keystone');
    const tail = res.signals.find((s) => s.issueKey === 'D-3');
    expect(tail?.points).toBe(16);
  });

  it('detects circular dependencies', () => {
    const a = issue({ key: 'D-1', links: [{ relation: 'blockedBy', key: 'D-2', statusCategory: 'new' }] });
    const b = issue({ key: 'D-2', links: [{ relation: 'blockedBy', key: 'D-1', statusCategory: 'new' }] });
    const res = detectBlockerChains(ctx([a, b]));
    expect(res.cycles).toEqual([['D-1', 'D-2']]);
    expect(res.signals.filter((s) => s.kind === 'circular_dependency')).toHaveLength(2);
  });
});

describe('detectStale', () => {
  it('flags in-progress work without updates beyond the threshold', () => {
    const a = issue({ key: 'D-1', statusCategory: 'indeterminate', status: 'In Progress', updated: '2026-11-15T12:00:00Z' });
    const [s] = detectStale(a, ctx([a]));
    expect(s?.kind).toBe('stale');
    expect(s?.severity).toBe('medium'); // 120h vs 72h
    expect(s?.evidence[0]?.value).toBe('2026-11-15T12:00:00Z');
  });
  it('escalates when more than twice the threshold', () => {
    const a = issue({ key: 'D-1', statusCategory: 'indeterminate', updated: '2026-11-10T12:00:00Z' });
    expect(detectStale(a, ctx([a]))[0]?.severity).toBe('high');
  });
  it('ignores to-do and fresh items', () => {
    expect(detectStale(issue({ key: 'D-1', updated: '2026-11-01T00:00:00Z' }), ctx([]))).toEqual([]);
    expect(detectStale(issue({ key: 'D-2', statusCategory: 'indeterminate' }), ctx([]))).toEqual([]);
    expect(detectStale(issue({ key: 'D-3', statusCategory: 'indeterminate', updated: 'garbage' }), ctx([]))).toEqual([]);
  });
});

describe('detectDueDates', () => {
  it('detects overdue work and scales points', () => {
    const [s] = detectDueDates(issue({ key: 'D-1', dueDate: '2026-11-17' }), ctx([]));
    expect(s?.kind).toBe('overdue');
    expect(s?.message).toContain('3 days overdue');
    expect(s?.points).toBe(39);
    expect(s?.severity).toBe('high');
  });
  it('marks long-overdue items critical', () => {
    expect(detectDueDates(issue({ key: 'D-1', dueDate: '2026-11-01' }), ctx([]))[0]?.severity).toBe('critical');
  });
  it('warns about items due soon that have not started', () => {
    const [s] = detectDueDates(issue({ key: 'D-1', dueDate: '2026-11-21' }), ctx([]));
    expect(s?.kind).toBe('due_soon_not_started');
  });
  it('ignores done items, far due dates, invalid dates and missing dates', () => {
    expect(detectDueDates(issue({ key: 'D-1', dueDate: '2026-11-01', statusCategory: 'done' }), ctx([]))).toEqual([]);
    expect(detectDueDates(issue({ key: 'D-2', dueDate: '2026-12-30' }), ctx([]))).toEqual([]);
    expect(detectDueDates(issue({ key: 'D-3' }), ctx([]))).toEqual([]);
    expect(detectDueDates(issue({ key: 'D-4', dueDate: 'nope' }), ctx([]))).toEqual([]);
    expect(detectDueDates(issue({ key: 'D-5', dueDate: '2026-11-21', statusCategory: 'indeterminate' }), ctx([]))).toEqual([]);
  });
});

describe('detectMissingAcceptanceCriteria', () => {
  it('flags stories without AC and empty descriptions', () => {
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-1', descriptionText: 'Do the thing' }))[0]?.points).toBe(12);
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-2', descriptionText: '' }))[0]?.points).toBe(15);
  });
  it('accepts checklists, Given/When/Then, and skips bugs/subtasks/done', () => {
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-1', descriptionText: 'x', hasChecklist: true }))).toEqual([]);
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-2', descriptionText: 'Given a cart when I pay then I get a receipt' }))).toEqual([]);
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-3', descriptionText: '', issueType: 'Bug' }))).toEqual([]);
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-4', descriptionText: '', isSubtask: true, issueType: 'Subtask' }))).toEqual([]);
    expect(detectMissingAcceptanceCriteria(issue({ key: 'D-5', descriptionText: '', statusCategory: 'done' }))).toEqual([]);
  });
});

describe('detectUnansweredQuestion', () => {
  const q = (created: string, author = bob, text = 'Which API version should we target?') => ({ id: created, author, created, text });
  it('grades severity by age', () => {
    expect(detectUnansweredQuestion(issue({ key: 'D-1', comments: [q('2026-11-20T10:00:00Z')] }), ctx([]))[0]?.severity).toBe('low');
    expect(detectUnansweredQuestion(issue({ key: 'D-2', comments: [q('2026-11-19T06:00:00Z')] }), ctx([]))[0]?.severity).toBe('medium');
    expect(detectUnansweredQuestion(issue({ key: 'D-3', comments: [q('2026-11-15T06:00:00Z')] }), ctx([]))[0]?.severity).toBe('high');
  });
  it('treats a reply by someone else as an answer', () => {
    const comments = [q('2026-11-18T10:00:00Z'), { id: 'r', author: alice, created: '2026-11-18T11:00:00Z', text: 'v2.' }];
    expect(detectUnansweredQuestion(issue({ key: 'D-1', comments }), ctx([]))).toEqual([]);
  });
  it('a follow-up by the same author does not answer it', () => {
    const comments = [q('2026-11-18T10:00:00Z'), { id: 'r', author: bob, created: '2026-11-18T11:00:00Z', text: 'bump' }];
    expect(detectUnansweredQuestion(issue({ key: 'D-1', comments }), ctx([]))).toHaveLength(1);
  });
  it('ignores done issues and comments without questions', () => {
    expect(detectUnansweredQuestion(issue({ key: 'D-1', statusCategory: 'done', comments: [q('2026-11-18T10:00:00Z')] }), ctx([]))).toEqual([]);
    expect(detectUnansweredQuestion(issue({ key: 'D-2', comments: [q('2026-11-18T10:00:00Z', bob, 'Done.')] }), ctx([]))).toEqual([]);
  });
});

describe('scope creep', () => {
  it('uses the changelog when available', () => {
    const added = issue({ key: 'D-1', addedToSprintAt: '2026-11-18T10:00:00Z', storyPoints: 5 });
    const [s] = detectScopeCreep(added, ctx([added]));
    expect(s?.confidence).toBe('high');
    expect(s?.message).toContain('+5 pts');
    expect(detectScopeCreep(issue({ key: 'D-2' }), ctx([]))).toEqual([]);
  });
  it('falls back to created date with low confidence', () => {
    const i = issue({ key: 'D-1', changelogAvailable: false, created: '2026-11-17T00:00:00Z', addedToSprintAt: undefined });
    expect(scopeStatus(i, sprint)).toEqual({ added: true, confidence: 'low', at: '2026-11-17T00:00:00Z' });
    expect(scopeStatus(issue({ key: 'D-2', changelogAvailable: false }), sprint).added).toBe(false);
  });
  it('uses activatedDate as baseline and ignores future sprints', () => {
    const i = issue({ key: 'D-1', addedToSprintAt: '2026-11-16T10:00:00Z' });
    expect(scopeStatus(i, { ...sprint, activatedDate: '2026-11-16T11:00:00Z' }).added).toBe(false);
    expect(scopeStatus(i, { ...sprint, state: 'future' }).added).toBe(false);
    expect(scopeStatus(i, { ...sprint, startDate: undefined }).added).toBe(false);
  });
});

describe('detectUnassigned', () => {
  it('flags unassigned open issues in active sprints only', () => {
    expect(detectUnassigned(issue({ key: 'D-1', assignee: null }), ctx([]))).toHaveLength(1);
    expect(detectUnassigned(issue({ key: 'D-2', assignee: null }), ctx([], { sprint: { ...sprint, state: 'future' } }))).toEqual([]);
    expect(detectUnassigned(issue({ key: 'D-3' }), ctx([]))).toEqual([]);
  });
});

describe('assignee load', () => {
  it('flags people over the points or WIP limit', () => {
    const issues = [
      issue({ key: 'D-1', assignee: alice, storyPoints: 13, statusCategory: 'indeterminate' }),
      issue({ key: 'D-2', assignee: alice, storyPoints: 8 }),
      issue({ key: 'D-3', assignee: bob, storyPoints: 3 }),
      issue({ key: 'D-4', assignee: bob, storyPoints: 5, statusCategory: 'done' }),
      issue({ key: 'D-5', assignee: null, storyPoints: 2 }),
    ];
    const loads = computeAssigneeLoad(issues, DEFAULT_SETTINGS);
    const a = loads.find((l) => l.accountId === 'a-1');
    expect(a?.overloaded).toBe(true);
    expect(a?.reasons[0]).toContain('21 remaining story points');
    expect(detectOverload(issues[0] as IssueRecord, loads)).toEqual([]); // in progress: not re-balanceable
    const b = loads.find((l) => l.accountId === 'b-2');
    expect(b?.overloaded).toBe(false);
    expect(b?.donePoints).toBe(5);
    expect(loads.find((l) => l.accountId === null)?.displayName).toBe('Unassigned');
    expect(detectOverload(issues[1] as IssueRecord, loads)).toHaveLength(1);
    expect(detectOverload(issues[2] as IssueRecord, loads)).toEqual([]);
    expect(detectOverload(issues[4] as IssueRecord, loads)).toEqual([]);
  });

  it('uses WIP, team median and Teamwork Graph context', () => {
    const many = Array.from({ length: 6 }, (_, n) => issue({ key: `D-${n}`, assignee: cara, statusCategory: n < 4 ? 'indeterminate' : 'new' }));
    const issues = [...many, issue({ key: 'D-10', assignee: alice }), issue({ key: 'D-11', assignee: bob }), issue({ key: 'D-12', assignee: bob })];
    const loads = computeAssigneeLoad(issues, DEFAULT_SETTINGS, {
      available: true,
      source: 'teamwork-graph',
      people: { 'a-1': { teams: ['Payments'], openWorkElsewhere: 25, openWorkElsewhereCapped: true } },
    });
    const c = loads.find((l) => l.accountId === 'c-3');
    expect(c?.reasons.some((r) => r.includes('WIP'))).toBe(true);
    expect(c?.reasons.some((r) => r.includes('team median'))).toBe(true);
    const a = loads.find((l) => l.accountId === 'a-1');
    expect(a?.teams).toEqual(['Payments']);
    expect(a?.reasons[0]).toContain('25+ more unresolved work items');
    const sig = detectOverload(many[4] as IssueRecord, loads);
    expect(sig[0]?.confidence).toBe('medium');
  });
});
