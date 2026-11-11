import Resolver from '@forge/resolver';
import type { ActionPayload } from './actions/handlers';
import { makeHandlers } from './actions/handlers';
import { accountIdFrom, appDeps, confluenceAsUser, jiraAsUser, opDeps, siteUrl, userDeps } from './lib/forge';
import { makeResolvers } from './resolvers/handlers';
import { runAnalysis } from './service';
import { watchedProjects } from './storage/store';

/**
 * Forge entry points. Handlers referenced from manifest.yml as `index.<name>`.
 * Every Rovo action is also exposed as a tool through the rovo:mcp module.
 */

const env = { deps: userDeps, opDeps, accountId: (c: unknown) => accountIdFrom(c as Record<string, unknown>) };
const actions = makeHandlers(env);

type Ctx = Record<string, unknown>;
const safe =
  <T>(fn: (p: ActionPayload, c: Ctx) => Promise<T>) =>
  async (payload: ActionPayload, context: Ctx) => {
    try {
      return await fn(payload ?? {}, context);
    } catch (e) {
      console.error('Sprint Sentinel action failed', e);
      return { status: 'error', message: `Sprint Sentinel could not complete this request: ${(e as Error).message.slice(0, 400)}` };
    }
  };

// ----- Read-only actions (actionVerb GET) -----
export const analyzeSprintRisk = safe((p) => actions.analyzeSprintRisk(p));
export const explainIssueRisk = safe((p) => actions.explainIssueRisk(p));
export const getAssigneeLoad = safe((p) => actions.getAssigneeLoad(p));
export const listSprints = safe((p) => actions.listSprints(p));
export const getRiskTrend = safe((p) => actions.getRiskTrend(p));

// ----- Write actions: two-phase, confirmation token enforced server side -----
export const addRiskComment = safe((p, c) => actions.writeOperation('add-risk-comment', p, c));
export const addRiskLabel = safe((p, c) => actions.writeOperation('add-risk-label', p, c));
export const createFollowupSubtask = safe((p, c) => actions.writeOperation('create-followup-subtask', p, c));
export const flagIssue = safe((p, c) => actions.writeOperation('flag-issue', p, c));
export const publishRiskReport = safe((p, c) => actions.writeOperation('publish-risk-report', p, c));

// ----- Custom UI resolver -----
const resolvers = makeResolvers({ ...env, confluence: confluenceAsUser, siteUrl: () => siteUrl(jiraAsUser) });
const resolver = new Resolver();
for (const [name, fn] of Object.entries(resolvers)) resolver.define(name, fn as never);
export const handler = resolver.getDefinitions();

// ----- Scheduled trigger: daily snapshot of every watched project's active sprint (builds the trend line) -----
export async function dailySnapshot(): Promise<void> {
  const deps = appDeps();
  for (const projectKey of await watchedProjects(deps.kv)) {
    try {
      const out = await runAnalysis(deps, projectKey);
      console.log(`Snapshot ${projectKey}: ${out.result ? `risk ${out.result.riskScore}` : out.message}`);
    } catch (e) {
      console.warn(`Snapshot failed for ${projectKey}`, (e as Error).message);
    }
  }
}
