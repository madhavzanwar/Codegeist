import type { AnalysisInput, IssueRecord, SprintInfo } from '../src/core/types';
import { DEFAULT_SETTINGS } from '../src/core/types';

export const NOW = new Date('2026-11-20T12:00:00Z');

export const alice = { accountId: 'a-1', displayName: 'Alice' };
export const bob = { accountId: 'b-2', displayName: 'Bob' };
export const cara = { accountId: 'c-3', displayName: 'Cara' };

let seq = 0;
export function issue(partial: Partial<IssueRecord> & { key: string }): IssueRecord {
  seq++;
  return {
    id: String(10000 + seq),
    summary: `Issue ${partial.key}`,
    issueType: 'Story',
    isSubtask: false,
    status: 'To Do',
    statusCategory: 'new',
    assignee: alice,
    reporter: bob,
    created: '2026-11-10T09:00:00Z',
    updated: '2026-11-20T09:00:00Z',
    labels: [],
    flagged: false,
    descriptionText: 'As a user I want X.\nAcceptance criteria:\n- it works',
    hasChecklist: false,
    comments: [],
    commentsTotal: 0,
    links: [],
    addedToSprintAt: '2026-11-15T08:00:00Z',
    changelogAvailable: true,
    ...partial,
  };
}

export const sprint: SprintInfo = {
  id: 7,
  name: 'Sprint 7',
  state: 'active',
  startDate: '2026-11-16T09:00:00Z',
  endDate: '2026-11-26T09:00:00Z',
  goal: 'Ship checkout v2',
};

export function input(issues: IssueRecord[], overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return { now: NOW, project: { key: 'DEMO', name: 'Demo' }, sprint, issues, settings: DEFAULT_SETTINGS, ...overrides };
}
