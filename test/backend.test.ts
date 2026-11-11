import { describe, expect, it } from 'vitest';
import { makeHandlers, resolveIssueKey, resolveProjectKey, toSprintId } from '../src/actions/handlers';
import { HttpError, defaultRetry, paginateOffset, qs, request, requestJson, retryDelay } from '../src/jira/http';
import { addedToSprintAt, buildFieldMap, mapIssue, mapLinks, mapSprint, toPerson } from '../src/jira/mapper';
import { resolveSprint } from '../src/jira/service';
import type { OpDeps } from '../src/ops';
import { runOperation } from '../src/ops';
import { makeResolvers } from '../src/resolvers/handlers';
import type { Deps } from '../src/service';
import { loadGraphContext, resetFieldMapCache, runAnalysis } from '../src/service';
import { cacheResult, getCachedResult, memoryKV, putPending, takePending, watchedProjects } from '../src/storage/store';
import { buildPeopleQuery, parsePeopleResponse, userAri } from '../src/twg/parse';
import { FIELDS, SPRINT, fakeRequester, rawIssue, response } from './fake-jira';

const noSleep = { ...defaultRetry, sleep: async () => undefined };
const NOW = new Date('2026-11-20T12:00:00Z');

function jiraFake() {
  const issues = [
    rawIssue('DEMO-1', {
      issuelinks: [{ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'DEMO-2', fields: { status: { statusCategory: { key: 'new' } } } } }],
      duedate: '2026-11-18',
    }),
    rawIssue('DEMO-2', { status: { name: 'To Do', statusCategory: { key: 'new' } } }, {
      histories: [{ created: '2026-11-18T10:00:00.000+0000', items: [{ field: 'Sprint', from: '', to: '5' }] }],
      total: 1,
    }),
  ];
  const labels: Record<string, string[]> = { 'DEMO-1': [] };
  const jira = fakeRequester([
    ['GET', /^\/rest\/api\/3\/project\/DEMO$/, () => ({ body: { id: '1', key: 'DEMO', name: 'Demo' } })],
    ['GET', /^\/rest\/api\/3\/project\/NOPE$/, () => ({ status: 404, body: {} })],
    ['GET', /^\/rest\/agile\/1\.0\/board\?/, () => ({ body: { values: [{ id: 1, name: 'B', type: 'scrum' }, { id: 2, name: 'K', type: 'kanban' }], isLast: true } })],
    ['GET', /^\/rest\/agile\/1\.0\/board\/1\/sprint/, () => ({ body: { values: [SPRINT, { ...SPRINT, id: 6, name: 'Next', state: 'future' }], isLast: true } })],
    ['GET', /^\/rest\/api\/3\/field$/, () => ({ body: FIELDS })],
    ['POST', /^\/rest\/api\/3\/search\/jql$/, () => ({ body: { issues, isLast: true } })],
    ['GET', /^\/rest\/api\/3\/issue\/DEMO-1\?/, () => ({ body: { key: 'DEMO-1', fields: { summary: 'S1', project: { key: 'DEMO' }, labels: labels['DEMO-1'], status: { name: 'In Progress' }, customfield_10020: [{ id: 5, state: 'active' }] } } })],
    ['PUT', /^\/rest\/api\/3\/issue\/DEMO-1$/, (c) => {
      const add = (c.body as { update?: { labels?: Array<{ add: string }> } }).update?.labels?.[0]?.add;
      if (add) labels['DEMO-1']?.push(add);
      return { status: 204 };
    }],
    ['POST', /^\/rest\/api\/3\/issue\/DEMO-1\/comment$/, () => ({ status: 201, body: { id: 'c1' } })],
  ]);
  return jira;
}

function deps(jira = jiraFake(), graph?: Deps['graph']): Deps & { kv: ReturnType<typeof memoryKV> } {
  resetFieldMapCache();
  return { jira, kv: memoryKV(), now: () => NOW, ...(graph ? { graph } : {}) };
}

describe('http', () => {
  it('retries on 429 honouring Retry-After and then succeeds', async () => {
    let n = 0;
    const waits: number[] = [];
    const req = async () => (++n < 3 ? response(429, 'slow down', { 'Retry-After': '2' }) : response(200, { ok: true }));
    const out = await requestJson(req, '/x', {}, { ...defaultRetry, sleep: async (ms) => void waits.push(ms) });
    expect(out).toEqual({ ok: true });
    expect(waits).toEqual([2000, 2000]);
  });
  it('gives up after max retries and throws HttpError', async () => {
    const req = async () => response(503, 'down');
    const res = await request(req, '/x', {}, noSleep);
    expect(res.status).toBe(503);
    await expect(requestJson(req, '/x', {}, noSleep)).rejects.toBeInstanceOf(HttpError);
  });
  it('computes backoff and query strings', () => {
    expect(retryDelay(0, null, defaultRetry)).toBe(500);
    expect(retryDelay(10, null, defaultRetry)).toBe(8000);
    expect(retryDelay(0, new Date(Date.now() + 1000).toUTCString(), defaultRetry)).toBeLessThanOrEqual(1000);
    expect(qs({ a: 1, b: undefined, c: 'x y' })).toBe('?a=1&c=x%20y');
    expect(qs({})).toBe('');
  });
  it('handles 204 and empty bodies', async () => {
    expect(await requestJson(async () => response(204), '/x')).toBeUndefined();
    expect(await requestJson(async () => response(200), '/x')).toBeUndefined();
  });
  it('paginates offset endpoints', async () => {
    const req = async (p: string) => {
      const startAt = Number(/startAt=(\d+)/.exec(p)?.[1]);
      return response(200, { values: startAt < 4 ? [startAt, startAt + 1] : [], total: 4 });
    };
    expect(await paginateOffset<number>(req, (s) => `/x?startAt=${s}`, (p) => p.values as number[])).toEqual([0, 1, 2, 3]);
  });
});

describe('mapper', () => {
  it('maps fields, links, comments and sprint-add dates', () => {
    const map = buildFieldMap(FIELDS);
    expect(map).toEqual({ storyPoints: ['customfield_10016'], flagged: 'customfield_10021', sprint: 'customfield_10020' });
    const raw = rawIssue('DEMO-9', {
      customfield_10021: [{ value: 'Impediment' }],
      comment: { comments: [{ id: '1', author: { accountId: 'u2', displayName: 'Raj' }, created: '2026-11-19T00:00:00Z', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why?' }] }] } }], total: 3 },
      issuelinks: [
        { type: { name: 'Blocks', inward: 'is blocked by' }, outwardIssue: { key: 'DEMO-3', fields: { summary: 'x', status: { statusCategory: { key: 'done' } } } } },
        { type: { name: 'Relates', inward: 'relates to' }, outwardIssue: { key: 'DEMO-4' } },
        { type: { name: 'Blocks' } },
      ],
      parent: { key: 'DEMO-1' },
    }, { histories: [{ created: '2026-11-17T00:00:00Z', items: [{ field: 'Sprint', from: '4', to: '4, 5' }] }, { created: '2026-11-18T00:00:00Z', items: [{ field: 'status' }] }], total: 9 });
    const { issue, changelogTruncated } = mapIssue(raw, map, 5);
    expect(issue).toMatchObject({ key: 'DEMO-9', storyPoints: 3, flagged: true, parentKey: 'DEMO-1', commentsTotal: 3, addedToSprintAt: '2026-11-17T00:00:00Z', priority: 'High' });
    expect(issue.links).toEqual([{ relation: 'blocks', key: 'DEMO-3', summary: 'x', statusCategory: 'done' }]);
    expect(issue.comments[0]?.text).toBe('Why?');
    expect(changelogTruncated).toBe(true);
  });
  it('handles missing data defensively', () => {
    expect(addedToSprintAt(undefined, 5, 'c')).toEqual({ available: false, truncated: false });
    expect(addedToSprintAt({ histories: [] }, 5, 'created')).toEqual({ at: 'created', available: true, truncated: false });
    expect(toPerson(null)).toBeNull();
    expect(mapLinks('nope')).toEqual([]);
    const { issue } = mapIssue({ key: 'X-1', fields: {} }, { storyPoints: [] }, 1);
    expect(issue).toMatchObject({ key: 'X-1', statusCategory: 'new', assignee: null, changelogAvailable: false, labels: [] });
    expect(mapSprint({ id: 3, state: 'weird' })).toEqual({ id: 3, name: 'Sprint 3', state: 'future' });
  });
});

describe('sprint resolution and analysis', () => {
  it('picks the active sprint and runs the full pipeline with snapshots', async () => {
    const d = deps();
    const out = await runAnalysis(d, 'DEMO');
    expect(out.result?.status).toBe('ok');
    expect(out.result?.sprint.name).toBe('Sprint 5');
    expect(out.sprints.map((s) => s.id)).toEqual([5, 6]);
    expect(out.result?.findings.some((f) => f.kind === 'blocked')).toBe(true);
    expect(out.result?.findings.some((f) => f.kind === 'scope_creep')).toBe(true);
    expect(await watchedProjects(d.kv)).toEqual(['DEMO']);
    expect(await getCachedResult(d.kv, 'DEMO', 5, NOW.getTime(), 1000)).not.toBeNull();
    expect(d.jira.calls.find((c) => c.path === '/rest/api/3/search/jql')?.body).toMatchObject({ jql: 'sprint = 5 ORDER BY rank ASC', expand: 'changelog' });
  });
  it('reports missing projects and sprints instead of inventing data', async () => {
    expect((await runAnalysis(deps(), 'NOPE')).message).toContain('not found');
    const noBoards = fakeRequester([
      ['GET', /project\/DEMO$/, () => ({ body: { id: '1', key: 'DEMO', name: 'Demo' } })],
      ['GET', /board\?/, () => ({ body: { values: [], isLast: true } })],
    ]);
    expect((await runAnalysis(deps(noBoards), 'DEMO')).message).toContain('no Scrum board');
    const choice = await resolveSprint(jiraFake(), 'DEMO', 999);
    expect(choice.sprint).toBeNull();
  });
  it('falls back to the next future sprint', async () => {
    const jira = fakeRequester([
      ['GET', /board\?/, () => ({ body: { values: [{ id: 1, name: 'B', type: 'scrum' }], isLast: true } })],
      ['GET', /board\/1\/sprint/, () => ({ body: { values: [{ ...SPRINT, state: 'future' }], isLast: true } })],
    ]);
    const c = await resolveSprint(jira, 'DEMO');
    expect(c.reason).toContain('next planned sprint');
  });
  it('enriches with Teamwork Graph and degrades gracefully', async () => {
    const graph = async () => ({ data: { t0: { edges: [{ node: { displayName: 'Payments' } }] }, w0: { edges: [{ node: { key: 'OTHER-1', resolvedAt: null } }], pageInfo: { hasNextPage: true } } } });
    const out = await runAnalysis(deps(jiraFake(), graph), 'DEMO');
    expect(out.result?.graph.used).toBe(true);
    expect(out.result?.assignees.find((a) => a.accountId === 'u1')?.teams).toEqual(['Payments']);
    const failing = await loadGraphContext(async () => { throw new Error('boom'); }, ['u1'], new Set());
    expect(failing).toMatchObject({ available: false, note: 'request failed: boom' });
    expect(await loadGraphContext(undefined, ['u1'], new Set())).toBeUndefined();
    expect(await loadGraphContext(graph, [], new Set())).toBeUndefined();
  });
});

describe('teamwork graph parsing', () => {
  it('builds aliased curated queries', () => {
    const q = buildPeopleQuery(['a', 'b']);
    expect(q.query).toContain('t1: atlassianUserInTeams(userId: $u1, first: 25)');
    expect(q.query).toContain('w0: atlassianUserAssignedJiraWorkItems');
    expect(q.variables).toEqual({ u0: userAri('a'), u1: userAri('b') });
  });
  it('reports empty results and errors honestly', () => {
    expect(parsePeopleResponse({ data: {} }, ['a'], new Set())).toMatchObject({ available: false, note: expect.stringContaining('scopes may not be granted') });
    expect(parsePeopleResponse({ errors: [{ message: 'denied' }] }, ['a'], new Set()).note).toBe('denied');
    const partial = parsePeopleResponse({ data: { t0: { edges: [{ node: { displayName: 'T' } }] } }, errors: [{ message: 'w0 failed' }] }, ['a'], new Set());
    expect(partial).toMatchObject({ available: true, note: 'partial data: w0 failed' });
    const counted = parsePeopleResponse({ data: { w0: { edges: [{ node: { key: 'S-1' } }, { node: { key: 'O-1' } }, { node: { key: 'O-2', resolvedAt: 'x' } }] } } }, ['a'], new Set(['S-1']));
    expect(counted.people.a).toEqual({ teams: [], openWorkElsewhere: 1, openWorkElsewhereCapped: false });
  });
});

describe('two-phase write operations', () => {
  function opDeps(d = deps()): OpDeps {
    let n = 0;
    return { ...d, confluence: fakeRequester([]), accountId: 'acc-1', newToken: () => `tok-${++n}`, siteUrl: 'https://acme.atlassian.net' };
  }

  it('previews without writing, then executes only with the token', async () => {
    const d = opDeps();
    const first = await runOperation('add-risk-label', { issueKey: 'demo-1' }, d);
    expect(first.status).toBe('confirmation_required');
    if (first.status !== 'confirmation_required') throw new Error();
    expect(first.preview).toContain('Add the label "sentinel-at-risk" to DEMO-1');
    expect((d.jira as ReturnType<typeof fakeRequester>).calls.some((c) => c.method === 'PUT')).toBe(false);
    const done = await runOperation('add-risk-label', { issueKey: 'DEMO-1', confirmationToken: first.confirmationToken }, d);
    expect(done).toMatchObject({ status: 'done', message: 'Label "sentinel-at-risk" added to DEMO-1.' });
    // token is single-use
    const again = await runOperation('add-risk-label', { issueKey: 'DEMO-1', confirmationToken: first.confirmationToken }, d);
    expect(again).toMatchObject({ status: 'rejected', message: expect.stringContaining('already-used') });
  });

  it('rejects tampered arguments, other users and bad input', async () => {
    const d = opDeps();
    const first = await runOperation('add-risk-comment', { issueKey: 'DEMO-1', comment: 'Any ETA on DEMO-2?' }, d);
    if (first.status !== 'confirmation_required') throw new Error('expected preview');
    expect(first.preview).toContain('Any ETA on DEMO-2?');
    const tampered = await runOperation('add-risk-comment', { issueKey: 'DEMO-1', comment: 'something else', confirmationToken: first.confirmationToken }, d);
    expect(tampered).toMatchObject({ status: 'rejected', message: expect.stringContaining('changed') });

    const second = await runOperation('add-risk-comment', { issueKey: 'DEMO-1', comment: 'Any ETA?' }, d);
    if (second.status !== 'confirmation_required') throw new Error('expected preview');
    const other = await runOperation('add-risk-comment', { issueKey: 'DEMO-1', comment: 'Any ETA?', confirmationToken: second.confirmationToken }, { ...d, accountId: 'intruder' });
    expect(other).toMatchObject({ status: 'rejected', message: expect.stringContaining('different user') });

    expect(await runOperation('add-risk-label', { issueKey: 'not a key' }, d)).toMatchObject({ status: 'rejected', message: expect.stringContaining('issueKey') });
    expect(await runOperation('drop-table', {}, d)).toMatchObject({ status: 'rejected' });
    expect(await runOperation('add-risk-label', { issueKey: 'DEMO-1' }, { ...d, accountId: '' })).toMatchObject({ status: 'rejected' });
  });

  it('stores pending operations single-use', async () => {
    const kv = memoryKV();
    await putPending(kv, 't', { op: 'x', argsHash: 'h', accountId: 'a', createdAt: 0, expiresAt: 1, preview: '' });
    expect(await takePending(kv, 't')).toBeDefined();
    expect(await takePending(kv, 't')).toBeUndefined();
  });

  it('caches results only under the size limit', async () => {
    const kv = memoryKV();
    const huge = { project: { key: 'P' }, sprint: { id: 1 }, blob: 'x'.repeat(300_000) } as never;
    await cacheResult(kv, huge, 0);
    expect(kv.data.size).toBe(0);
  });
});

describe('action handlers', () => {
  const env = (d = deps()) => ({
    deps: () => d,
    opDeps: async (accountId: string) => ({ ...d, confluence: fakeRequester([]), accountId, newToken: () => 'tok', siteUrl: undefined }),
    accountId: () => 'acc-1',
  });

  it('resolves keys from inputs or Atlassian context', () => {
    expect(resolveProjectKey({ projectKey: 'demo' })).toBe('DEMO');
    expect(resolveProjectKey({ issueKey: 'abc-1' })).toBe('ABC');
    expect(resolveProjectKey({ context: { jira: { projectKey: 'CTX' } } })).toBe('CTX');
    expect(resolveProjectKey({})).toBeUndefined();
    expect(resolveIssueKey({ context: { jira: { issueKey: 'CTX-3' } } })).toBe('CTX-3');
    expect(resolveIssueKey({ context: { jira: { issueKey: 1, url: 'https://x/browse/AB-12' } } })).toBe('AB-12');
    expect(toSprintId('12')).toBe(12);
    expect(toSprintId('x')).toBeUndefined();
  });

  it('analyses, explains, loads, lists and trends', async () => {
    const h = makeHandlers(env());
    const a = (await h.analyzeSprintRisk({ projectKey: 'DEMO' })) as { riskScore: number; topFindings: unknown[] };
    expect(a.riskScore).toBeGreaterThan(0);
    expect(a.topFindings.length).toBeGreaterThan(0);
    expect(await h.analyzeSprintRisk({})).toMatchObject({ status: 'needs_input' });
    expect(await h.explainIssueRisk({ issueKey: 'DEMO-1' })).toMatchObject({ status: 'ok', found: true });
    expect(await h.explainIssueRisk({})).toMatchObject({ status: 'needs_input' });
    expect(await h.getAssigneeLoad({ projectKey: 'DEMO' })).toMatchObject({ status: 'ok' });
    expect(await h.listSprints({ projectKey: 'DEMO' })).toMatchObject({ status: 'ok', sprints: [{ id: 5 }, { id: 6 }] });
    expect(await h.getRiskTrend({ projectKey: 'DEMO' })).toMatchObject({ status: 'ok', hasPrevious: false });
    const later = deps();
    await runAnalysis(later, 'DEMO');
    const h2 = makeHandlers(env({ ...later, now: () => new Date(NOW.getTime() + 3_600_000) }));
    expect(await h2.getRiskTrend({ projectKey: 'DEMO' })).toMatchObject({ status: 'ok', hasPrevious: true, direction: expect.any(String) });
    expect(await h.analyzeSprintRisk({ projectKey: 'NOPE' })).toMatchObject({ status: 'no_data' });
  });

  it('routes write operations through confirmation', async () => {
    const h = makeHandlers(env());
    const r = await h.writeOperation('add-risk-comment', { comment: 'ping please', context: { jira: { issueKey: 'DEMO-1' } } }, {});
    expect(r).toMatchObject({ status: 'confirmation_required', arguments: { issueKey: 'DEMO-1' } });
    const report = await h.writeOperation('publish-risk-report', { projectKey: 'DEMO' }, {});
    expect(report).toMatchObject({ status: 'rejected', message: expect.stringContaining('spaceKey') });
  });
});

describe('resolvers', () => {
  it('serves dashboard, issue panel and settings', async () => {
    const d = deps();
    const r = makeResolvers({
      deps: () => d,
      opDeps: async (accountId) => ({ ...d, confluence: fakeRequester([]), accountId, newToken: () => 't', siteUrl: undefined }),
      confluence: fakeRequester([['GET', /spaces/, () => ({ body: { results: [{ id: 1, key: 'ENG', name: 'Engineering' }] } })]]),
      accountId: () => 'acc',
      siteUrl: async () => 'https://acme.atlassian.net',
    });
    const ctx = { extension: { project: { key: 'DEMO' }, issue: { key: 'DEMO-1' } } };
    const dash = await r.getDashboard({ payload: {}, context: ctx });
    expect(dash.result?.status).toBe('ok');
    expect(dash.siteUrl).toBe('https://acme.atlassian.net');
    const panel = await r.getIssueRisk({ payload: {}, context: ctx });
    expect(panel).toMatchObject({ inSprint: true, found: true });
    const s = await r.saveSettings({ payload: { staleAfterHours: 0, maxPointsPerPerson: 21, reportSpaceKey: ' ENG ' }, context: ctx });
    expect(s).toMatchObject({ staleAfterHours: 1, maxPointsPerPerson: 21, reportSpaceKey: 'ENG' });
    expect(await r.listSpaces()).toMatchObject({ available: true, spaces: [{ id: '1', key: 'ENG' }] });
    await expect(r.getDashboard({ payload: {}, context: {} })).rejects.toThrow('No Jira project');
    const op = await r.operation({ payload: { op: 'add-risk-label', args: { issueKey: 'DEMO-1' } }, context: ctx });
    expect(op.status).toBe('confirmation_required');
    expect(await r.seedStatus({ payload: {}, context: ctx })).toBeNull();
  });

  it('reports Confluence as unavailable when the app is not connected', async () => {
    const d = deps();
    const r = makeResolvers({
      deps: () => d,
      opDeps: async () => { throw new Error('unused'); },
      confluence: fakeRequester([['GET', /spaces/, () => ({ status: 403, body: { message: 'App is not installed on this instance' } })]]),
      accountId: () => 'acc',
      siteUrl: async () => undefined,
    });
    const res = await r.listSpaces();
    expect(res.available).toBe(false);
    expect(res.message).toContain('connect');
  });
});
