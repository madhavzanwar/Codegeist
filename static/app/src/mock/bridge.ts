/**
 * Local-development mock of @forge/bridge (used only with `vite --mode mock`).
 * It runs the REAL risk engine (src/core) over the demo seed dataset with simulated timestamps,
 * so the UI can be developed and screenshotted without a Jira site. Never shipped to Forge.
 */
import { analyzeSprint, explainIssue } from './engine';
import { computeTrend, toSnapshot } from '../../../../src/core/trend';
import { DEFAULT_SETTINGS } from '../../../../src/core/types';
import type { IssueRecord, Snapshot, SprintInfo } from '../../../../src/core/types';
import { SEED_ISSUES, SEED_LINKS, SEED_SPRINT_GOAL, SEED_SPRINT_NAME } from '../../../../src/seed/dataset';

const params = new URLSearchParams(location.search);
const MODULE = params.get('module') ?? 'sprint-sentinel-project-page';
const NOW = new Date('2026-12-03T15:00:00Z');
const DAY = 86_400_000;
const START = new Date(NOW.getTime() - 6 * DAY);
const people = [
  { accountId: 'u-maya', displayName: 'Maya Chen' },
  { accountId: 'u-leo', displayName: 'Leo Okafor' },
  { accountId: 'u-priya', displayName: 'Priya Nair' },
  { accountId: 'u-sam', displayName: 'Sam Rivera' },
];
const iso = (d: number) => new Date(d).toISOString();

const keys: Record<string, string> = {};
SEED_ISSUES.forEach((s, i) => (keys[s.ref] = `CHK-${i + 101}`));

function buildIssues(): IssueRecord[] {
  return SEED_ISSUES.filter((s) => s.phase !== 'backlog').map((s, i) => {
    const key = keys[s.ref] as string;
    const status = s.status === 'done' ? 'Done' : s.status === 'progress' ? 'In Progress' : 'To Do';
    const links = SEED_LINKS.flatMap(([a, b]): IssueRecord['links'] => {
      const other = (ref: string) => SEED_ISSUES.find((x) => x.ref === ref);
      const cat = (ref: string) => (other(ref)?.status === 'done' ? 'done' : other(ref)?.status === 'progress' ? 'indeterminate' : 'new') as IssueRecord['statusCategory'];
      if (a === s.ref) return [{ relation: 'blocks' as const, key: keys[b] as string, statusCategory: cat(b) }];
      if (b === s.ref) return [{ relation: 'blockedBy' as const, key: keys[a] as string, statusCategory: cat(a) }];
      return [];
    });
    const stale = s.status === 'progress' && i % 3 === 0;
    return {
      key,
      id: String(i),
      summary: s.summary,
      issueType: s.type,
      isSubtask: false,
      status,
      statusCategory: s.status === 'done' ? 'done' : s.status === 'progress' ? 'indeterminate' : 'new',
      assignee: s.assignee === null ? null : (people[s.assignee % people.length] ?? null),
      reporter: people[3] ?? null,
      created: iso(START.getTime() - 4 * DAY),
      updated: iso(NOW.getTime() - (stale ? 4.5 * DAY : 0.3 * DAY)),
      ...(s.dueInDays !== undefined ? { dueDate: iso(NOW.getTime() + s.dueInDays * DAY).slice(0, 10) } : {}),
      ...(s.points !== undefined ? { storyPoints: s.points } : {}),
      labels: ['sentinel-demo'],
      flagged: !!s.flagged,
      descriptionText: s.description,
      hasChecklist: false,
      comments: (s.comments ?? []).map((t, n) => ({ id: `${i}-${n}`, author: people[(n + 1) % 4] ?? null, created: iso(NOW.getTime() - (2 - n) * DAY), text: t })),
      commentsTotal: (s.comments ?? []).length,
      links,
      addedToSprintAt: s.phase === 'creep' ? iso(START.getTime() + (2 + (i % 3)) * DAY) : iso(START.getTime() - 3_600_000),
      changelogAvailable: true,
    };
  });
}

const sprint: SprintInfo = { id: 42, name: SEED_SPRINT_NAME, state: 'active', startDate: START.toISOString(), endDate: iso(START.getTime() + 10 * DAY), goal: SEED_SPRINT_GOAL, boardId: 1 };
const graph = {
  available: true,
  source: 'teamwork-graph' as const,
  people: {
    'u-maya': { teams: ['Payments Platform'], openWorkElsewhere: 14, openWorkElsewhereCapped: false },
    'u-leo': { teams: ['Checkout Squad'], openWorkElsewhere: 3, openWorkElsewhereCapped: false },
    'u-priya': { teams: ['Checkout Squad', 'Design Systems'], openWorkElsewhere: 6, openWorkElsewhereCapped: false },
    'u-sam': { teams: ['Checkout Squad'], openWorkElsewhere: 1, openWorkElsewhereCapped: false },
  },
};

let issues = buildIssues();
function run(now = NOW) {
  return analyzeSprint({ now, project: { key: 'CHK', name: 'Checkout' }, sprint, issues, settings: DEFAULT_SETTINGS, graph });
}
const history: Snapshot[] = [4, 3, 2, 1].map((d, n) => {
  const r = run(new Date(NOW.getTime() - d * DAY));
  const snap = toSnapshot(r);
  return { ...snap, riskScore: Math.max(0, (snap.riskScore ?? 0) - (8 - n * 2)), healthScore: null };
});

let tokenN = 0;
const pendings = new Map<string, { op: string; args: Record<string, unknown> }>();

export async function invoke(fn: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120));
  const result = run();
  switch (fn) {
    case 'getDashboard':
      return {
        projectKey: 'CHK',
        result,
        trend: computeTrend(toSnapshot(result), history),
        sprints: [{ id: 42, name: SEED_SPRINT_NAME, state: 'active' }, { id: 41, name: 'Checkout v1 hardening', state: 'closed' }],
        settings: { ...DEFAULT_SETTINGS, reportSpaceKey: 'ENG' },
        message: null,
        lastReport: null,
        siteUrl: 'https://example.atlassian.net',
      };
    case 'getIssueRisk': {
      const key = params.get('issue') ?? (keys.applepay as string);
      return { issueKey: key, inSprint: true, sprint: sprint.name, sprintRisk: result.riskScore, sprintBand: result.band, ...explainIssue(result, key) };
    }
    case 'getOverview':
      return {
        projects: [
          { projectKey: 'CHK', sprintName: sprint.name, riskScore: result.riskScore, healthScore: result.healthScore, at: NOW.toISOString(), history: [...history, toSnapshot(result)].map((s) => ({ at: s.at, riskScore: s.riskScore })) },
          { projectKey: 'MOB', sprintName: 'Mobile 24', riskScore: 31, healthScore: 69, at: NOW.toISOString(), history: [40, 37, 35, 31].map((v, i) => ({ at: iso(NOW.getTime() - (4 - i) * DAY), riskScore: v })) },
          { projectKey: 'PLAT', sprintName: 'Platform Q4-3', riskScore: 18, healthScore: 82, at: NOW.toISOString(), history: [22, 25, 19, 18].map((v, i) => ({ at: iso(NOW.getTime() - (4 - i) * DAY), riskScore: v })) },
        ],
      };
    case 'listSpaces':
      return { available: true, spaces: [{ id: '1', key: 'ENG', name: 'Engineering' }, { id: '2', key: 'CHK', name: 'Checkout Team' }] };
    case 'saveSettings':
      return payload;
    case 'operation': {
      const { op, args } = payload as { op: string; args: Record<string, unknown> };
      if (args.confirmationToken) {
        const p = pendings.get(String(args.confirmationToken));
        pendings.delete(String(args.confirmationToken));
        if (!p) return { status: 'rejected', operation: op, message: 'Unknown or already-used confirmation token.' };
        if (op === 'flag-issue') issues = issues.map((i) => (i.key === args.issueKey ? { ...i, flagged: true } : i));
        return { status: 'done', operation: op, message: `Done: ${op} on ${String(args.issueKey ?? args.parentKey ?? args.spaceKey)}.`, details: {} };
      }
      const token = `mock-${++tokenN}`;
      pendings.set(token, { op, args });
      const preview =
        op === 'add-risk-comment'
          ? `Add this comment to ${String(args.issueKey)}:\n\n${String(args.comment)}`
          : op === 'publish-risk-report'
            ? `Publish a new Confluence page "Sprint Risk Report — CHK — ${sprint.name}" in space Engineering (ENG) with sprint risk ${result.riskScore}/100, ${result.findings.length} findings and the trend vs. the last run.`
            : op === 'flag-issue'
              ? `Flag ${String(args.issueKey)} as an impediment and add the comment: "${String(args.reason)}".`
              : op === 'add-risk-label'
                ? `Add the label "${String(args.label)}" to ${String(args.issueKey)} (current labels: sentinel-demo).`
                : `Create a sub-task under ${String(args.parentKey)}:\nSummary: ${String(args.summary)}\nLabel: sentinel-followup`;
      return { status: 'confirmation_required', operation: op, preview, confirmationToken: token, expiresInMinutes: 15, arguments: args };
    }
    case 'seedStep':
      return { ok: true, progress: 1, message: 'Mock: demo data ready.', state: { done: true, log: [] } };
    default:
      throw new Error(`mock: unknown resolver ${fn}`);
  }
}

export const view = {
  getContext: async () => ({ moduleKey: MODULE }),
  theme: { enable: async () => undefined },
};
export const rovo = { isEnabled: async () => true, open: async (p: unknown) => console.log('rovo.open', p) };
export const router = { open: async (u: string) => console.log('router.open', u) };
