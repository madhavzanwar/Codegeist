import { explainIssue } from '../core/summary';
import { listSpaces, ConfluenceUnavailableError } from '../confluence/service';
import type { Requester } from '../jira/http';
import { PROJECT_KEY_RE } from '../jira/http';
import { getIssueBasics } from '../jira/service';
import type { OpDeps } from '../ops';
import { runOperation } from '../ops';
import { initialState, runNextStep } from '../seed/executor';
import type { SeedState } from '../seed/executor';
import type { Deps } from '../service';
import { cachedFieldMap, runAnalysis } from '../service';
import type { ProjectSettings } from '../storage/store';
import { getCachedResult, keys, projectOverview, saveSettings } from '../storage/store';

/** Custom UI resolver functions (dashboard + issue panel). */

export interface ResolverEnv {
  deps: () => Deps;
  opDeps: (accountId: string) => Promise<OpDeps>;
  confluence: Requester;
  accountId: (context: unknown) => string;
  siteUrl: () => Promise<string | undefined>;
}

type Ctx = { extension?: { project?: { key?: string }; issue?: { key?: string } }; [k: string]: unknown };

function projectFrom(payload: { projectKey?: unknown }, context: Ctx): string {
  const key = String(payload.projectKey ?? context.extension?.project?.key ?? '').toUpperCase();
  if (!PROJECT_KEY_RE.test(key)) throw new Error('No Jira project in context.');
  return key;
}

function clampNumber(v: unknown, min: number, max: number): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

export function makeResolvers(env: ResolverEnv) {
  return {
    async getDashboard({ payload, context }: { payload: { projectKey?: string; sprintId?: number }; context: Ctx }) {
      const projectKey = projectFrom(payload, context);
      const deps = env.deps();
      const out = await runAnalysis(deps, projectKey, payload.sprintId ? Number(payload.sprintId) : undefined);
      const lastReport = await deps.kv.get(keys.lastReport(projectKey));
      return {
        projectKey,
        result: out.result,
        trend: out.trend,
        sprints: out.sprints.map((s) => ({ id: s.id, name: s.name, state: s.state })),
        settings: out.settings,
        message: out.message ?? null,
        lastReport: lastReport ?? null,
        siteUrl: (await env.siteUrl()) ?? null,
      };
    },

    async getIssueRisk({ context }: { payload: unknown; context: Ctx }) {
      const issueKey = context.extension?.issue?.key;
      if (!issueKey) throw new Error('No issue in context.');
      const deps = env.deps();
      const map = await cachedFieldMap(deps.jira, deps.now().getTime());
      const basics = await getIssueBasics(deps.jira, issueKey, map);
      const sprintId = basics.sprintIds[0];
      if (!sprintId) return { issueKey, inSprint: false, message: `${issueKey} is not in a sprint, so there is no sprint risk to show.` };
      const cached = await getCachedResult(deps.kv, basics.projectKey, sprintId, deps.now().getTime(), 5 * 60_000);
      const result = cached ?? (await runAnalysis(deps, basics.projectKey, sprintId)).result;
      if (!result) return { issueKey, inSprint: false, message: 'Could not load the sprint.' };
      return { issueKey, inSprint: true, sprint: result.sprint.name, sprintRisk: result.riskScore, sprintBand: result.band, ...explainIssue(result, issueKey) };
    },

    async saveSettings({ payload, context }: { payload: Partial<ProjectSettings> & { projectKey?: string }; context: Ctx }) {
      const projectKey = projectFrom(payload, context);
      const patch: Partial<ProjectSettings> = {};
      const stale = clampNumber(payload.staleAfterHours, 1, 24 * 30);
      const pts = clampNumber(payload.maxPointsPerPerson, 1, 200);
      const wip = clampNumber(payload.maxWipPerPerson, 1, 20);
      const q = clampNumber(payload.unansweredQuestionHours, 1, 24 * 14);
      if (stale !== undefined) patch.staleAfterHours = stale;
      if (pts !== undefined) patch.maxPointsPerPerson = pts;
      if (wip !== undefined) patch.maxWipPerPerson = wip;
      if (q !== undefined) patch.unansweredQuestionHours = q;
      if (typeof payload.reportSpaceKey === 'string') patch.reportSpaceKey = payload.reportSpaceKey.trim().slice(0, 255);
      return saveSettings(env.deps().kv, projectKey, patch);
    },

    async getOverview() {
      return { projects: await projectOverview(env.deps().kv) };
    },

    async listSpaces() {
      try {
        return { available: true, spaces: await listSpaces(env.confluence) };
      } catch (e) {
        if (e instanceof ConfluenceUnavailableError) return { available: false, spaces: [], message: e.message };
        return { available: false, spaces: [], message: (e as Error).message.slice(0, 300) };
      }
    },

    /** Phase 1 (no token) or phase 2 (with token) of a confirmed write. */
    async operation({ payload, context }: { payload: { op: string; args: Record<string, unknown> }; context: Ctx }) {
      const deps = await env.opDeps(env.accountId(context));
      return runOperation(payload.op, payload.args ?? {}, deps);
    },

    async seedStatus({ payload, context }: { payload: { projectKey?: string }; context: Ctx }) {
      const projectKey = projectFrom(payload, context);
      return (await env.deps().kv.get<SeedState>(keys.seed(projectKey))) ?? null;
    },

    async seedStep({ payload, context }: { payload: { projectKey?: string; reset?: boolean }; context: Ctx }) {
      const projectKey = projectFrom(payload, context);
      const deps = env.deps();
      const existing = payload.reset ? undefined : await deps.kv.get<SeedState>(keys.seed(projectKey));
      const state = existing ?? initialState(projectKey, deps.now());
      try {
        const step = await runNextStep(deps.jira, state, deps.now());
        await deps.kv.set(keys.seed(projectKey), step.state);
        return { ok: true, ...step };
      } catch (e) {
        if (state.step === 0) await deps.kv.delete(keys.seed(projectKey));
        return { ok: false, state, progress: 0, message: (e as Error).message.slice(0, 500) };
      }
    },
  };
}
