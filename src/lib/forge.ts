import api, { assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import type { HttpResponse, Requester } from '../jira/http';
import { requestJson } from '../jira/http';
import type { OpDeps } from '../ops';
import type { Deps, GraphRequester } from '../service';
import type { KV } from '../storage/store';

/**
 * The only module that touches Forge runtime APIs. Everything else receives these adapters,
 * which keeps the business logic unit-testable.
 */

// All paths passed here are built from constants plus encodeURIComponent'd segments (see jira/http.ts `seg`).
const toRoute = (path: string) => assumeTrustedRoute(path);

export const jiraAsUser: Requester = (path, init) => api.asUser().requestJira(toRoute(path), init) as Promise<HttpResponse>;
export const jiraAsApp: Requester = (path, init) => api.asApp().requestJira(toRoute(path), init) as Promise<HttpResponse>;
export const confluenceAsUser: Requester = (path, init) => api.asUser().requestConfluence(toRoute(path), init) as Promise<HttpResponse>;
export const confluenceAsApp: Requester = (path, init) => api.asApp().requestConfluence(toRoute(path), init) as Promise<HttpResponse>;

export const teamworkGraphAsUser: GraphRequester = async (query, variables) => {
  const res = await api.asUser().requestTeamworkGraph(query, variables, 'sprintSentinel_people');
  return res.json();
};

export const forgeKV: KV = {
  get: <T>(key: string) => kvs.get<T>(key),
  set: <T>(key: string, value: T) => kvs.set<T>(key, value),
  delete: (key: string) => kvs.delete(key),
};

let siteUrlCache: string | undefined;
export async function siteUrl(jira: Requester): Promise<string | undefined> {
  if (siteUrlCache) return siteUrlCache;
  try {
    const info = await requestJson<{ baseUrl?: string }>(jira, '/rest/api/3/serverInfo');
    siteUrlCache = info.baseUrl;
  } catch {
    siteUrlCache = undefined;
  }
  return siteUrlCache;
}

export function userDeps(): Deps {
  return { jira: jiraAsUser, kv: forgeKV, now: () => new Date(), graph: teamworkGraphAsUser };
}

export function appDeps(): Deps {
  return { jira: jiraAsApp, kv: forgeKV, now: () => new Date() };
}

export async function opDeps(accountId: string): Promise<OpDeps> {
  const base = userDeps();
  return { ...base, confluence: confluenceAsUser, accountId, newToken: randomUUID, siteUrl: await siteUrl(base.jira) };
}

type AnyContext = Record<string, unknown> | undefined;

/** Account id of the invoking user, from either Forge function context shape. */
export function accountIdFrom(context: AnyContext): string {
  const c = (context ?? {}) as { principal?: { accountId?: string }; accountId?: string };
  return c.principal?.accountId ?? c.accountId ?? '';
}
