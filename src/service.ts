import { analyzeSprint } from './core/analyze';
import { computeTrend, toSnapshot } from './core/trend';
import type { GraphContext, ProjectInfo, SprintInfo, SprintRiskResult, TrendReport } from './core/types';
import type { Requester } from './jira/http';
import { HttpError } from './jira/http';
import type { FieldMap } from './jira/mapper';
import { fetchSprintIssues, getFieldMap, getProject, resolveSprint } from './jira/service';
import type { KV, ProjectSettings } from './storage/store';
import { cacheResult, getSettings, getSnapshots, recordSnapshot, watchProject } from './storage/store';
import { buildPeopleQuery, parsePeopleResponse } from './twg/parse';

/** Orchestrates fetch → analyse → snapshot. Shared by Rovo actions, MCP tools, the UI and the scheduled trigger. */

export type GraphRequester = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

export interface Deps {
  jira: Requester;
  kv: KV;
  now: () => Date;
  /** Teamwork Graph GraphQL executor; omit to skip graph enrichment (e.g. in scheduled triggers without a user). */
  graph?: GraphRequester;
}

export interface AnalysisOutcome {
  result: SprintRiskResult | null;
  trend: TrendReport | null;
  sprints: SprintInfo[];
  project: ProjectInfo | null;
  settings: ProjectSettings;
  message?: string;
}

const MAX_GRAPH_PEOPLE = 12;

export async function loadGraphContext(graph: GraphRequester | undefined, accountIds: string[], sprintKeys: Set<string>): Promise<GraphContext | undefined> {
  if (!graph) return undefined;
  const ids = [...new Set(accountIds)].slice(0, MAX_GRAPH_PEOPLE);
  if (!ids.length) return undefined;
  try {
    const { query, variables } = buildPeopleQuery(ids);
    return parsePeopleResponse(await graph(query, variables), ids, sprintKeys);
  } catch (e) {
    return { available: false, source: 'teamwork-graph', note: `request failed: ${(e as Error).message}`.slice(0, 200), people: {} };
  }
}

let fieldMapCache: { at: number; map: FieldMap } | null = null;
export async function cachedFieldMap(jira: Requester, now: number): Promise<FieldMap> {
  if (fieldMapCache && now - fieldMapCache.at < 10 * 60_000) return fieldMapCache.map;
  const map = await getFieldMap(jira);
  fieldMapCache = { at: now, map };
  return map;
}
export function resetFieldMapCache(): void {
  fieldMapCache = null;
}

export async function runAnalysis(
  deps: Deps,
  projectKey: string,
  sprintId?: number,
  opts: { record?: boolean } = {},
): Promise<AnalysisOutcome> {
  const settings = await getSettings(deps.kv, projectKey);
  let project: ProjectInfo;
  try {
    const p = await getProject(deps.jira, projectKey);
    project = { key: p.key, name: p.name };
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403))
      return { result: null, trend: null, sprints: [], project: null, settings, message: `Project ${projectKey} was not found or you do not have permission to see it.` };
    throw e;
  }
  const choice = await resolveSprint(deps.jira, project.key, sprintId);
  if (!choice.sprint) return { result: null, trend: null, sprints: choice.sprints, project, settings, message: choice.reason ?? 'No sprint found.' };

  const now = deps.now();
  const map = await cachedFieldMap(deps.jira, now.getTime());
  const { issues, notes } = await fetchSprintIssues(deps.jira, choice.sprint.id, map);
  const graph = await loadGraphContext(
    deps.graph,
    issues.map((i) => i.assignee?.accountId).filter((x): x is string => !!x),
    new Set(issues.map((i) => i.key)),
  );
  const dataNotes = [...notes, ...(choice.reason && sprintId === undefined ? [choice.reason] : [])];
  if (!map.storyPoints.length) dataNotes.push('No story point field exists on this site; effort is measured in issue counts.');

  const result = analyzeSprint({
    now,
    project,
    sprint: choice.sprint,
    issues,
    settings,
    ...(graph ? { graph } : {}),
    dataNotes,
  });
  const snap = toSnapshot(result);
  const history = await getSnapshots(deps.kv, project.key, choice.sprint.id);
  const trend = computeTrend(snap, history);
  if (opts.record !== false && result.status === 'ok') {
    await recordSnapshot(deps.kv, project.key, snap);
    await watchProject(deps.kv, project.key);
  }
  await cacheResult(deps.kv, result, now.getTime());
  return { result, trend, sprints: choice.sprints, project, settings, ...(choice.reason ? { message: choice.reason } : {}) };
}
