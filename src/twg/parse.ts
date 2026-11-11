import type { GraphContext } from '../core/types';

/**
 * Teamwork Graph (curated queries) — query builder and response parser. Pure.
 * Uses `atlassianUserInTeams` (teams a person belongs to) and `atlassianUserAssignedJiraWorkItems`
 * (work assigned to that person anywhere on the site) to enrich assignee-load analysis.
 */

export const TWG_PAGE = 25; // curated queries cap `first` at 25

export function userAri(accountId: string): string {
  return `ari:cloud:identity::user/${accountId}`;
}

export function buildPeopleQuery(accountIds: string[]): { query: string; variables: Record<string, string> } {
  const vars = accountIds.map((_, i) => `$u${i}: ID!`).join(', ');
  const body = accountIds
    .map(
      (_, i) => `
  t${i}: atlassianUserInTeams(userId: $u${i}, first: ${TWG_PAGE}) { edges { node { __typename ... on AtlassianTeam { id displayName } } } }
  w${i}: atlassianUserAssignedJiraWorkItems(userId: $u${i}, first: ${TWG_PAGE}) { edges { node { __typename ... on JiraWorkItem { key resolvedAt } } } pageInfo { hasNextPage } }`,
    )
    .join('');
  const variables: Record<string, string> = {};
  accountIds.forEach((id, i) => (variables[`u${i}`] = userAri(id)));
  return { query: `query sprintSentinel_people(${vars}) {${body}\n}`, variables };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const nodes = (conn: unknown): Json[] => {
  const edges = obj(conn).edges;
  return Array.isArray(edges) ? edges.map((e) => obj(obj(e).node)) : [];
};

export function parsePeopleResponse(json: unknown, accountIds: string[], sprintIssueKeys: Set<string>): GraphContext {
  const root = obj(json);
  const data = obj(root.data);
  const errors = Array.isArray(root.errors) ? (root.errors as Json[]) : [];
  const people: GraphContext['people'] = {};
  let anyData = false;
  accountIds.forEach((id, i) => {
    const teams = nodes(data[`t${i}`])
      .map((n) => n.displayName)
      .filter((n): n is string => typeof n === 'string');
    const workConn = data[`w${i}`];
    const work = nodes(workConn);
    if (teams.length || work.length) anyData = true;
    const elsewhere = work.filter((n) => typeof n.key === 'string' && !sprintIssueKeys.has(n.key) && !n.resolvedAt).length;
    people[id] = {
      teams,
      ...(workConn !== undefined && workConn !== null ? { openWorkElsewhere: elsewhere, openWorkElsewhereCapped: obj(obj(workConn).pageInfo).hasNextPage === true } : {}),
    };
  });
  if (!anyData) {
    const msg = errors.length ? String(errors[0]?.message ?? 'unknown error') : 'no data returned — the Teamwork Graph scopes may not be granted on this site';
    return { available: false, source: 'teamwork-graph', note: msg.slice(0, 200), people };
  }
  return { available: true, source: 'teamwork-graph', ...(errors.length ? { note: `partial data: ${String(errors[0]?.message ?? '')}`.slice(0, 200) } : {}), people };
}
