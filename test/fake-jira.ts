import type { HttpResponse, Requester } from '../src/jira/http';

export interface Call {
  method: string;
  path: string;
  body?: unknown;
}

type Handler = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

export function response(status: number, body?: unknown, headers: Record<string, string> = {}): HttpResponse {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n] ?? headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/** A tiny programmable fake for Jira/Confluence REST. Routes are [method, regex, handler]. */
export function fakeRequester(routes: Array<[string, RegExp, Handler]>): Requester & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (path: string, init?: { method?: string; body?: string }) => {
    const call: Call = { method: init?.method ?? 'GET', path, ...(init?.body ? { body: JSON.parse(init.body) } : {}) };
    calls.push(call);
    for (const [m, re, h] of routes) {
      if (m === call.method && re.test(path)) {
        const r = h(call);
        if (r) return response(r.status ?? 200, r.body, r.headers);
      }
    }
    return response(404, { errorMessages: [`no route for ${call.method} ${path}`] });
  }) as Requester & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

export const FIELDS = [
  { id: 'summary', name: 'Summary' },
  { id: 'customfield_10016', name: 'Story point estimate' },
  { id: 'customfield_10021', name: 'Flagged' },
  { id: 'customfield_10020', name: 'Sprint', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
];

export function rawIssue(key: string, extra: Record<string, unknown> = {}, changelog?: unknown) {
  return {
    id: key.replace(/\D/g, ''),
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story', subtask: false },
      priority: { name: 'High' },
      assignee: { accountId: 'u1', displayName: 'Uma' },
      reporter: { accountId: 'u2', displayName: 'Raj' },
      created: '2026-11-16T10:00:00.000+0000',
      updated: '2026-11-20T10:00:00.000+0000',
      labels: ['x'],
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Acceptance criteria: ok' }] }] },
      comment: { comments: [], total: 0 },
      issuelinks: [],
      customfield_10016: 3,
      customfield_10021: null,
      ...extra,
    },
    ...(changelog !== undefined ? { changelog } : { changelog: { histories: [], total: 0 } }),
  };
}

export const SPRINT = { id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-11-16T09:00:00.000Z', endDate: '2026-11-26T09:00:00.000Z', originBoardId: 1, goal: 'Ship it' };
