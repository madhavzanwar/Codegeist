import { describe, expect, it } from 'vitest';
import { SEED_ISSUES, SEED_LINKS, SEED_SUBTASKS, dueDate } from '../src/seed/dataset';
import { STEPS, bulkCreate, initialState, issueFieldsFor, runNextStep } from '../src/seed/executor';
import type { SeedState } from '../src/seed/executor';
import { FIELDS, fakeRequester } from './fake-jira';

function fakeSite(opts: { invertLinks?: boolean; activeSprint?: boolean; failBulkIndex?: number; existing?: boolean } = {}) {
  let nextKey = 1;
  const links: Array<{ id: string; inward: string; outward: string }> = [];
  const sprints: Array<{ id: number; state: string; issues: string[] }> = [];
  const transitions: string[] = [];
  const req = fakeRequester([
    ['POST', /search\/jql$/, () => ({ body: { issues: opts.existing ? [{ key: 'P-1' }] : [] } })],
    ['GET', /\/rest\/agile\/1\.0\/board\?/, () => ({ body: { values: [{ id: 3, name: 'P board', type: 'scrum' }], isLast: true } })],
    ['GET', /\/rest\/agile\/1\.0\/board\/3\/sprint/, () => ({ body: { values: opts.activeSprint ? [{ name: 'Old' }] : [] } })],
    ['GET', /createmeta\/P\/issuetypes\?/, () => ({ body: { issueTypes: [
      { id: '1', name: 'Story', subtask: false }, { id: '2', name: 'Task', subtask: false }, { id: '3', name: 'Bug', subtask: false }, { id: '4', name: 'Subtask', subtask: true },
    ], total: 4 } })],
    ['GET', /createmeta\/P\/issuetypes\/1/, () => ({ body: { fields: [{ fieldId: 'summary' }, { fieldId: 'customfield_10016' }, { fieldId: 'duedate' }], total: 3 } })],
    ['GET', /\/rest\/api\/3\/field$/, () => ({ body: FIELDS })],
    ['GET', /issueLinkType$/, () => ({ body: { issueLinkTypes: [{ name: 'Relates', inward: 'relates to' }, { name: 'Blocks', inward: 'is blocked by' }] } })],
    ['GET', /user\/assignable\/search/, () => ({ body: [{ accountId: 'u1', accountType: 'atlassian' }, { accountId: 'bot', accountType: 'app' }, { accountId: 'u2' }] })],
    ['POST', /\/rest\/api\/3\/issue\/bulk$/, (c) => {
      const updates = (c.body as { issueUpdates: unknown[] }).issueUpdates;
      const errors = opts.failBulkIndex !== undefined && updates.length > 5 ? [{ failedElementNumber: opts.failBulkIndex }] : [];
      const issues = updates.filter((_, i) => i !== (errors.length ? opts.failBulkIndex : -1)).map(() => ({ id: String(nextKey), key: `P-${nextKey++}` }));
      return { status: 201, body: { issues, errors } };
    }],
    ['POST', /\/rest\/api\/3\/issue$/, () => ({ status: 201, body: { key: `P-${nextKey++}`, id: '0' } })],
    ['POST', /issueLink$/, (c) => {
      const b = c.body as { inwardIssue: { key: string }; outwardIssue: { key: string } };
      links.push({ id: String(links.length + 1), inward: b.inwardIssue.key, outward: b.outwardIssue.key });
      return { status: 201 };
    }],
    ['DELETE', /issueLink\/\d+$/, (c) => {
      const id = c.path.split('/').pop();
      links.splice(links.findIndex((l) => l.id === id), 1);
      return { status: 204 };
    }],
    ['GET', /\/rest\/api\/3\/issue\/P-\d+\?fields=issuelinks/, (c) => {
      const key = /issue\/(P-\d+)/.exec(c.path)?.[1] as string;
      // Real Jira semantics in this fake: {inwardIssue: A, outwardIssue: B} => "A blocks B" unless inverted.
      const asBlocker = (l: { inward: string; outward: string }) => (opts.invertLinks ? l.outward : l.inward);
      const asBlocked = (l: { inward: string; outward: string }) => (opts.invertLinks ? l.inward : l.outward);
      const issuelinks = links
        .filter((l) => l.inward === key || l.outward === key)
        .map((l) =>
          asBlocker(l) === key
            ? { id: l.id, type: { name: 'Blocks', inward: 'is blocked by' }, outwardIssue: { key: asBlocked(l) } }
            : { id: l.id, type: { name: 'Blocks', inward: 'is blocked by' }, inwardIssue: { key: asBlocker(l) } },
        );
      return { body: { fields: { issuelinks } } };
    }],
    ['POST', /\/rest\/agile\/1\.0\/sprint$/, () => {
      sprints.push({ id: 77, state: 'future', issues: [] });
      return { status: 201, body: { id: 77 } };
    }],
    ['POST', /\/rest\/agile\/1\.0\/sprint\/77\/issue$/, (c) => {
      sprints[0]?.issues.push(...(c.body as { issues: string[] }).issues);
      return { status: 204 };
    }],
    ['POST', /\/rest\/agile\/1\.0\/sprint\/77$/, (c) => {
      if (sprints[0]) sprints[0].state = (c.body as { state: string }).state;
      return { body: {} };
    }],
    ['GET', /transitions$/, () => ({ body: { transitions: [{ id: '11', to: { statusCategory: { key: 'new' } } }, { id: '21', to: { statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { statusCategory: { key: 'done' } } }] } })],
    ['POST', /transitions$/, (c) => {
      transitions.push(`${c.path}:${(c.body as { transition: { id: string } }).transition.id}`);
      return { status: 204 };
    }],
    ['POST', /comment$/, () => ({ status: 201, body: { id: 'c' } })],
    ['PUT', /\/rest\/api\/3\/issue\/P-\d+$/, () => ({ status: 204 })],
  ]);
  return { req, links, sprints, transitions };
}

async function runAll(site: ReturnType<typeof fakeSite>): Promise<SeedState> {
  let state = initialState('P', new Date('2026-11-20T10:00:00Z'));
  for (let i = 0; i < 40 && !state.done; i++) state = (await runNextStep(site.req, state, new Date('2026-11-20T10:00:00Z'))).state;
  return state;
}

describe('seed dataset', () => {
  it('is realistic and covers every risk pattern', () => {
    expect(SEED_ISSUES.length + SEED_SUBTASKS.length).toBeGreaterThanOrEqual(40);
    const refs = new Set(SEED_ISSUES.map((i) => i.ref));
    expect(refs.size).toBe(SEED_ISSUES.length);
    for (const [a, b] of SEED_LINKS) expect(refs.has(a) && refs.has(b)).toBe(true);
    for (const st of SEED_SUBTASKS) expect(refs.has(st.parent)).toBe(true);
    expect(SEED_ISSUES.some((i) => i.phase === 'creep')).toBe(true);
    expect(SEED_ISSUES.some((i) => i.flagged)).toBe(true);
    expect(SEED_ISSUES.some((i) => (i.dueInDays ?? 0) < 0)).toBe(true);
    expect(SEED_ISSUES.some((i) => i.assignee === null && i.phase === 'committed')).toBe(true);
    expect(dueDate(new Date('2026-11-20T00:00:00Z'), -3)).toBe('2026-11-17');
  });
});

describe('seed executor', () => {
  it('runs every step and builds the sprint with scope creep after start', async () => {
    const site = fakeSite();
    const state = await runAll(site);
    expect(state.done).toBe(true);
    expect(state.users).toEqual(['u1', 'u2']);
    expect(state.pointsField).toBe('customfield_10016');
    expect(Object.keys(state.keys)).toHaveLength(SEED_ISSUES.length);
    expect(state.subtaskKeys).toHaveLength(SEED_SUBTASKS.length);
    expect(site.links).toHaveLength(SEED_LINKS.length);
    expect(state.linkInwardIsBlocker).toBe(true);
    const committed = SEED_ISSUES.filter((i) => i.phase === 'committed').length;
    const creep = SEED_ISSUES.filter((i) => i.phase === 'creep').length;
    expect(site.sprints[0]?.state).toBe('active');
    expect(site.sprints[0]?.issues).toHaveLength(committed + creep);
    // start happens between committed and creep moves
    const calls = site.req.calls.map((c) => `${c.method} ${c.path}`);
    const start = calls.indexOf('POST /rest/agile/1.0/sprint/77');
    const moves = calls.map((c, i) => (c === 'POST /rest/agile/1.0/sprint/77/issue' ? i : -1)).filter((i) => i >= 0);
    expect(moves[0]).toBeLessThan(start);
    expect(moves[1]).toBeGreaterThan(start);
    expect(site.transitions.length).toBeGreaterThan(10);
    expect(state.log).toHaveLength(STEPS.length + Math.ceil(SEED_LINKS.length / 8) - 1 + 2);
    expect((await runNextStep(site.req, state, new Date())).message).toContain('already');
  });

  it('detects and corrects inverted link semantics', async () => {
    const site = fakeSite({ invertLinks: true });
    const state = await runAll(site);
    expect(state.linkInwardIsBlocker).toBe(false);
    expect(site.links).toHaveLength(SEED_LINKS.length);
    expect(site.req.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('refuses to seed over an active sprint or existing demo data', async () => {
    await expect(runNextStep(fakeSite({ activeSprint: true }).req, initialState('P', new Date()), new Date())).rejects.toThrow('already has an active sprint');
    await expect(runNextStep(fakeSite({ existing: true }).req, initialState('P', new Date()), new Date())).rejects.toThrow('already contains demo issues');
  });

  it('retries failed bulk elements without optional fields', async () => {
    const site = fakeSite({ failBulkIndex: 2 });
    const keys = await bulkCreate(
      site.req,
      Array.from({ length: 6 }, (_, i) => ({ full: { summary: `s${i}`, duedate: 'x' }, minimal: { summary: `s${i}` } })),
    );
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
    const single = site.req.calls.find((c) => c.path === '/rest/api/3/issue');
    expect(single?.body).toEqual({ fields: { summary: 's2' } });
  });

  it('omits optional fields when unsupported', () => {
    const s = { ...initialState('P', new Date()), typeIds: { Task: '2' }, users: [] };
    const f = issueFieldsFor(SEED_ISSUES[0] as never, s, new Date(), true);
    expect(f.assignee).toBeUndefined();
    expect(f.issuetype).toEqual({ id: '2' });
    expect(() => issueFieldsFor(SEED_ISSUES[0] as never, { ...s, typeIds: {} }, new Date())).toThrow('No usable issue type');
  });
});
