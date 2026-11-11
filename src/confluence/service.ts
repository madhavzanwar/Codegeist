import type { Requester } from '../jira/http';
import { HttpError, qs, requestJson, seg } from '../jira/http';

/** Confluence Cloud REST v2 access for publishing Sprint Risk Reports. */

export interface Space {
  id: string;
  key: string;
  name: string;
  type?: string;
}

export class ConfluenceUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Confluence is not reachable for Sprint Sentinel (${detail}). An admin must connect the app to Confluence on this site ` +
        '(Admin → Apps → Connected apps → Sprint Sentinel → connect Confluence), or reinstall it with Confluence selected.',
    );
    this.name = 'ConfluenceUnavailableError';
  }
}

function wrap(e: unknown): never {
  if (e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 404) && /not installed|unauthori|permission|scope/i.test(e.body + e.message)) {
    throw new ConfluenceUnavailableError(`HTTP ${e.status}`);
  }
  throw e;
}

export async function listSpaces(req: Requester, limit = 50): Promise<Space[]> {
  try {
    const r = await requestJson<{ results?: Space[] }>(req, `/wiki/api/v2/spaces${qs({ limit, status: 'current', sort: 'name' })}`);
    return (r.results ?? []).map((s) => ({ id: String(s.id), key: s.key, name: s.name, ...(s.type ? { type: s.type } : {}) }));
  } catch (e) {
    return wrap(e);
  }
}

export async function getSpaceByKey(req: Requester, key: string): Promise<Space | null> {
  try {
    const r = await requestJson<{ results?: Space[] }>(req, `/wiki/api/v2/spaces${qs({ keys: key, limit: 1 })}`);
    const s = r.results?.[0];
    return s ? { id: String(s.id), key: s.key, name: s.name } : null;
  } catch (e) {
    return wrap(e);
  }
}

export async function createPage(
  req: Requester,
  spaceId: string,
  title: string,
  storage: string,
  parentId?: string,
): Promise<{ id: string; title: string; webui?: string }> {
  try {
    const r = await requestJson<{ id: string; title: string; _links?: { webui?: string; base?: string } }>(req, '/wiki/api/v2/pages', {
      method: 'POST',
      body: { spaceId, status: 'current', title, ...(parentId ? { parentId } : {}), body: { representation: 'storage', value: storage } },
    });
    return { id: String(r.id), title: r.title, ...(r._links?.webui ? { webui: `${r._links.base ?? ''}${r._links.webui}` } : {}) };
  } catch (e) {
    return wrap(e);
  }
}

export async function getPageUrl(req: Requester, pageId: string): Promise<string | undefined> {
  const r = await requestJson<{ _links?: { webui?: string; base?: string } }>(req, `/wiki/api/v2/pages/${seg(pageId)}`).catch(() => null);
  return r?._links?.webui ? `${r._links.base ?? ''}${r._links.webui}` : undefined;
}
