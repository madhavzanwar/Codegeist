import { explainIssue, summarizeForAgent } from '../core/summary';
import { ISSUE_KEY_RE, PROJECT_KEY_RE } from '../jira/http';
import { getIssueBasics } from '../jira/service';
import type { OpDeps } from '../ops';
import { runOperation } from '../ops';
import type { Deps } from '../service';
import { cachedFieldMap, runAnalysis } from '../service';
import { getCachedResult } from '../storage/store';

/**
 * Rovo action / MCP tool handlers. Each Forge function receives (payload, context);
 * payload contains the declared inputs plus `context` with the Atlassian app context.
 */

export interface ActionPayload {
  [input: string]: unknown;
  context?: {
    jira?: { projectKey?: string; issueKey?: string | number; url?: string };
    confluence?: { spaceKey?: string };
  };
}

export interface HandlerEnv {
  deps: () => Deps;
  opDeps: (accountId: string) => Promise<OpDeps>;
  accountId: (context: unknown) => string;
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function resolveProjectKey(payload: ActionPayload): string | undefined {
  const fromInput = text(payload.projectKey)?.toUpperCase();
  if (fromInput && PROJECT_KEY_RE.test(fromInput)) return fromInput;
  const fromIssue = text(payload.issueKey)?.toUpperCase();
  if (fromIssue && ISSUE_KEY_RE.test(fromIssue)) return fromIssue.split('-')[0];
  const ctx = text(payload.context?.jira?.projectKey)?.toUpperCase();
  return ctx && PROJECT_KEY_RE.test(ctx) ? ctx : undefined;
}

export function resolveIssueKey(payload: ActionPayload, field = 'issueKey'): string | undefined {
  const fromInput = text(payload[field])?.toUpperCase();
  if (fromInput && ISSUE_KEY_RE.test(fromInput)) return fromInput;
  const ctx = payload.context?.jira?.issueKey;
  const ctxKey = typeof ctx === 'string' ? ctx.toUpperCase() : undefined;
  if (ctxKey && ISSUE_KEY_RE.test(ctxKey)) return ctxKey;
  // Fall back to the browse URL in the context, e.g. https://site/browse/ABC-1
  const m = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/.exec(text(payload.context?.jira?.url) ?? '');
  return m?.[1];
}

export function toSprintId(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const needProject = {
  status: 'needs_input',
  message: 'Which Jira project should I analyse? Provide a project key such as "DEMO" (or open the agent from inside a Jira project).',
};

export function makeHandlers(env: HandlerEnv) {
  const analyze = async (payload: ActionPayload) => {
    const projectKey = resolveProjectKey(payload);
    if (!projectKey) return needProject;
    const out = await runAnalysis(env.deps(), projectKey, toSprintId(payload.sprintId));
    if (!out.result)
      return {
        status: 'no_data',
        message: out.message,
        availableSprints: out.sprints.slice(0, 15).map((s) => ({ id: s.id, name: s.name, state: s.state })),
      };
    return summarizeForAgent(out.result, out.trend ?? undefined);
  };

  return {
    async analyzeSprintRisk(payload: ActionPayload) {
      return analyze(payload);
    },

    async explainIssueRisk(payload: ActionPayload) {
      const issueKey = resolveIssueKey(payload);
      if (!issueKey) return { status: 'needs_input', message: 'Which issue? Provide an issue key such as DEMO-12.' };
      const deps = env.deps();
      const map = await cachedFieldMap(deps.jira, deps.now().getTime());
      const basics = await getIssueBasics(deps.jira, issueKey, map);
      const sprintId = toSprintId(payload.sprintId) ?? basics.sprintIds[0];
      if (!sprintId)
        return { status: 'no_data', issueKey, message: `${issueKey} is not in any sprint, so it has no sprint risk score. Nothing was inferred.` };
      const cached = await getCachedResult(deps.kv, basics.projectKey, sprintId, deps.now().getTime(), 5 * 60_000);
      const result = cached ?? (await runAnalysis(deps, basics.projectKey, sprintId)).result;
      if (!result) return { status: 'no_data', issueKey, message: `Could not load the sprint for ${issueKey}.` };
      return { status: 'ok', ...explainIssue(result, issueKey) };
    },

    async getAssigneeLoad(payload: ActionPayload) {
      const projectKey = resolveProjectKey(payload);
      if (!projectKey) return needProject;
      const out = await runAnalysis(env.deps(), projectKey, toSprintId(payload.sprintId), { record: false });
      if (!out.result) return { status: 'no_data', message: out.message };
      return {
        status: 'ok',
        sprint: out.result.sprint.name,
        teamworkGraph: out.result.graph,
        assignees: out.result.assignees.map((a) => ({
          name: a.displayName,
          openIssues: a.openIssues,
          inProgress: a.inProgress,
          remainingPoints: a.remainingPoints,
          donePoints: a.donePoints,
          overloaded: a.overloaded,
          reasons: a.reasons,
          teams: a.teams,
          ...(a.openWorkElsewhere !== undefined ? { openWorkElsewhere: `${a.openWorkElsewhere}${a.openWorkElsewhereCapped ? '+' : ''}` } : {}),
        })),
        settings: { maxPointsPerPerson: out.settings.maxPointsPerPerson, maxWipPerPerson: out.settings.maxWipPerPerson },
      };
    },

    async listSprints(payload: ActionPayload) {
      const projectKey = resolveProjectKey(payload);
      if (!projectKey) return needProject;
      const out = await runAnalysis(env.deps(), projectKey, undefined, { record: false });
      return {
        status: out.sprints.length ? 'ok' : 'no_data',
        project: out.project,
        ...(out.message ? { message: out.message } : {}),
        sprints: out.sprints.slice(0, 25).map((s) => ({ id: s.id, name: s.name, state: s.state, startDate: s.startDate, endDate: s.endDate, goal: s.goal })),
      };
    },

    async getRiskTrend(payload: ActionPayload) {
      const projectKey = resolveProjectKey(payload);
      if (!projectKey) return needProject;
      const out = await runAnalysis(env.deps(), projectKey, toSprintId(payload.sprintId));
      if (!out.result || !out.trend) return { status: 'no_data', message: out.message };
      return { status: 'ok', sprint: out.result.sprint.name, currentRisk: out.result.riskScore, ...out.trend };
    },

    async writeOperation(op: string, payload: ActionPayload, context: unknown) {
      const accountId = env.accountId(context);
      const deps = await env.opDeps(accountId);
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) if (k !== 'context' && v !== undefined && v !== null && v !== '') args[k] = v;
      // Fill keys from the Atlassian app context when the agent is invoked on an issue or in a project.
      if (op === 'create-followup-subtask') {
        const parentKey = resolveIssueKey(payload, 'parentKey');
        if (parentKey) args.parentKey = parentKey;
      } else if (op === 'publish-risk-report') {
        const projectKey = resolveProjectKey(payload);
        if (projectKey) args.projectKey = projectKey;
        const sprintId = toSprintId(payload.sprintId);
        if (sprintId) args.sprintId = sprintId;
        else delete args.sprintId;
        if (!args.spaceKey) {
          const saved = projectKey ? (await deps.kv.get<{ reportSpaceKey?: string }>(`settings:${projectKey}`))?.reportSpaceKey : undefined;
          const ctxSpace = text(payload.context?.confluence?.spaceKey);
          if (saved ?? ctxSpace) args.spaceKey = saved ?? ctxSpace;
        }
      } else {
        const issueKey = resolveIssueKey(payload);
        if (issueKey) args.issueKey = issueKey;
      }
      return runOperation(op, args, deps);
    },
  };
}

export type Handlers = ReturnType<typeof makeHandlers>;
