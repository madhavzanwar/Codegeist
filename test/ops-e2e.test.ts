import { describe, expect, it } from 'vitest';
import type { OpDeps } from '../src/ops';
import { runOperation } from '../src/ops';
import { makeResolvers } from '../src/resolvers/handlers';
import { resetFieldMapCache } from '../src/service';
import { memoryKV } from '../src/storage/store';
import { FIELDS, SPRINT, fakeRequester, rawIssue } from './fake-jira';

const NOW = new Date('2026-11-20T12:00:00Z');

function site() {
  const jira = fakeRequester([
    ['GET', /project\/DEMO$/, () => ({ body: { id: '1', key: 'DEMO', name: 'Demo' } })],
    ['GET', /board\?/, () => ({ body: { values: [{ id: 1, name: 'B', type: 'scrum' }], isLast: true } })],
    ['GET', /board\/1\/sprint/, () => ({ body: { values: [SPRINT], isLast: true } })],
    ['GET', /\/field$/, () => ({ body: FIELDS })],
    ['POST', /search\/jql$/, () => ({ body: { issues: [rawIssue('DEMO-1', { duedate: '2026-11-10' })] } })],
    ['GET', /issue\/DEMO-1\?/, () => ({ body: { key: 'DEMO-1', fields: { summary: 'Pay', project: { key: 'DEMO' }, labels: ['sentinel-at-risk'], customfield_10021: [{ value: 'Impediment' }] } } })],
    ['PUT', /issue\/DEMO-1$/, () => ({ status: 204 })],
    ['POST', /issue\/DEMO-1\/comment$/, () => ({ status: 201, body: { id: 'c9' } })],
    ['GET', /createmeta\/DEMO\/issuetypes/, () => ({ body: { issueTypes: [{ id: '10', name: 'Story', subtask: false }, { id: '11', name: 'Subtask', subtask: true }], total: 2 } })],
    ['POST', /\/rest\/api\/3\/issue$/, () => ({ status: 201, body: { key: 'DEMO-50', id: '50' } })],
  ]);
  const pages: unknown[] = [];
  const confluence = fakeRequester([
    ['GET', /spaces\?keys=ENG/, () => ({ body: { results: [{ id: 42, key: 'ENG', name: 'Engineering' }] } })],
    ['GET', /spaces\?keys=NONE/, () => ({ body: { results: [] } })],
    ['POST', /wiki\/api\/v2\/pages$/, (c) => {
      pages.push(c.body);
      return { status: 200, body: { id: '900', title: (c.body as { title: string }).title, _links: { base: 'https://acme.atlassian.net/wiki', webui: '/spaces/ENG/pages/900' } } };
    }],
  ]);
  return { jira, confluence, pages };
}

function deps(s = site()): OpDeps & { pages: unknown[] } {
  resetFieldMapCache();
  let n = 0;
  return { jira: s.jira, confluence: s.confluence, kv: memoryKV(), now: () => NOW, accountId: 'acc', newToken: () => `t${++n}`, siteUrl: 'https://acme.atlassian.net', pages: s.pages };
}

async function confirmAndRun(op: string, args: Record<string, unknown>, d: OpDeps) {
  const p = await runOperation(op, args, d);
  if (p.status !== 'confirmation_required') throw new Error(`expected preview, got ${JSON.stringify(p)}`);
  return { preview: p.preview, done: await runOperation(op, { ...args, confirmationToken: p.confirmationToken }, d) };
}

describe('write operations end to end', () => {
  it('adds a comment with attribution', async () => {
    const d = deps();
    const { done } = await confirmAndRun('add-risk-comment', { issueKey: 'DEMO-1', comment: 'Can we get an ETA?' }, d);
    expect(done).toMatchObject({ status: 'done', details: { commentId: 'c9', url: 'https://acme.atlassian.net/browse/DEMO-1' } });
  });
  it('previews an existing label as a no-op', async () => {
    const p = await runOperation('add-risk-label', { issueKey: 'DEMO-1' }, deps());
    expect(p).toMatchObject({ preview: expect.stringContaining('already has the label') });
  });
  it('creates a follow-up sub-task', async () => {
    const d = deps();
    const { preview, done } = await confirmAndRun('create-followup-subtask', { parentKey: 'DEMO-1', summary: 'Define acceptance criteria', description: 'List AC' }, d);
    expect(preview).toContain('Create a sub-task under DEMO-1');
    expect(done).toMatchObject({ status: 'done', details: { key: 'DEMO-50' } });
    const create = (d.jira as ReturnType<typeof fakeRequester>).calls.find((c) => c.path === '/rest/api/3/issue');
    expect(create?.body).toMatchObject({ fields: { parent: { key: 'DEMO-1' }, issuetype: { id: '11' }, labels: ['sentinel-followup'] } });
  });
  it('flags an issue and comments the reason', async () => {
    const d = deps();
    const { preview, done } = await confirmAndRun('flag-issue', { issueKey: 'DEMO-1', reason: 'Waiting on PSP' }, d);
    expect(preview).toContain('already flagged');
    expect(done).toMatchObject({ status: 'done' });
    const put = (d.jira as ReturnType<typeof fakeRequester>).calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ fields: { customfield_10021: [{ value: 'Impediment' }] } });
  });
  it('publishes a Confluence report with trend and remembers the space', async () => {
    const d = deps();
    const { preview, done } = await confirmAndRun('publish-risk-report', { projectKey: 'DEMO', spaceKey: 'ENG' }, d);
    expect(preview).toContain('Publish a new Confluence page "Sprint Risk Report — DEMO — Sprint 5');
    expect(done).toMatchObject({ status: 'done', details: { pageId: '900', url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/900' } });
    const page = d.pages[0] as { spaceId: string; body: { representation: string; value: string } };
    expect(page.spaceId).toBe('42');
    expect(page.body.representation).toBe('storage');
    expect(page.body.value).toContain('Top risks');
    expect(await d.kv.get('settings:DEMO')).toMatchObject({ reportSpaceKey: 'ENG' });
    expect(await d.kv.get('last-report:DEMO')).toMatchObject({ pageId: '900' });
  });
  it('rejects unknown spaces at preview time', async () => {
    expect(await runOperation('publish-risk-report', { projectKey: 'DEMO', spaceKey: 'NONE' }, deps())).toMatchObject({ status: 'rejected', message: expect.stringContaining('not found') });
  });
});

describe('seed resolver', () => {
  it('reports seed errors and clears state on first-step failure', async () => {
    const d = deps();
    const r = makeResolvers({
      deps: () => d,
      opDeps: async () => d,
      confluence: d.confluence,
      accountId: () => 'acc',
      siteUrl: async () => undefined,
    });
    const res = await r.seedStep({ payload: { projectKey: 'DEMO' }, context: {} });
    expect(res.ok).toBe(false);
    expect(await d.kv.get('seed:DEMO')).toBeUndefined();
  });
});
