import { describe, expect, it } from 'vitest';
import { analyzeSprint, bandFor, maxSeverity, minConfidence, scoreIssue, timeFactor } from '../src/core/analyze';
import { explainIssue, summarizeForAgent } from '../src/core/summary';
import { computeTrend, toSnapshot } from '../src/core/trend';
import { alice, bob, cara, input, issue, sprint } from './fixtures';

function demoIssues() {
  return [
    issue({ key: 'D-1', statusCategory: 'indeterminate', status: 'In Progress', storyPoints: 8, assignee: alice, updated: '2026-11-14T00:00:00Z',
      links: [{ relation: 'blocks', key: 'D-2', statusCategory: 'new' }, { relation: 'blocks', key: 'D-5', statusCategory: 'new' }] }),
    issue({ key: 'D-2', storyPoints: 5, assignee: alice, links: [{ relation: 'blockedBy', key: 'D-1', statusCategory: 'indeterminate' }, { relation: 'blocks', key: 'D-3', statusCategory: 'new' }] }),
    issue({ key: 'D-3', storyPoints: 3, assignee: bob, links: [{ relation: 'blockedBy', key: 'D-2', statusCategory: 'new' }], dueDate: '2026-11-18' }),
    issue({ key: 'D-4', storyPoints: 3, assignee: bob, statusCategory: 'done', status: 'Done' }),
    issue({ key: 'D-5', storyPoints: 2, assignee: cara, descriptionText: 'todo', links: [{ relation: 'blockedBy', key: 'D-1', statusCategory: 'indeterminate' }],
      comments: [{ id: '1', author: bob, created: '2026-11-18T10:00:00Z', text: 'Should this support Safari?' }] }),
    issue({ key: 'D-6', storyPoints: 5, assignee: null, addedToSprintAt: '2026-11-19T10:00:00Z' }),
  ];
}

describe('helpers', () => {
  it('bands, severities, confidence, time factor', () => {
    expect([bandFor(0), bandFor(30), bandFor(60), bandFor(80)]).toEqual(['low', 'medium', 'high', 'critical']);
    expect(maxSeverity(['low', 'high', 'medium'])).toBe('high');
    expect(minConfidence(['high', 'low', 'medium'])).toBe('low');
    expect(timeFactor(null)).toBe(1);
    expect(timeFactor(1)).toBeCloseTo(1.15);
    expect(scoreIssue([{ kind: 'blocked', issueKey: 'X', points: 200, severity: 'high', confidence: 'high', message: '', evidence: [] }], 1)).toBe(100);
  });
});

describe('analyzeSprint', () => {
  const result = analyzeSprint(input(demoIssues()));

  it('produces sprint scores within range and consistent health', () => {
    expect(result.status).toBe('ok');
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(result.healthScore).toBe(100 - (result.riskScore as number));
    expect(result.components.map((c) => c.name)).toEqual(['Issue risk', 'Burn-down gap', 'Scope creep', 'Blocked work']);
    expect(result.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
  });

  it('computes metrics from Jira data only', () => {
    expect(result.metrics).toMatchObject({ totalIssues: 6, doneIssues: 1, totalPoints: 26, donePoints: 3, remainingPoints: 23, addedIssues: 1, addedPoints: 5, committedIssues: 5 });
    expect(result.metrics.elapsedFraction).toBeCloseTo(0.4, 1);
  });

  it('ranks issues and gives done issues zero risk', () => {
    expect(result.issues[0]?.score).toBeGreaterThanOrEqual(result.issues[1]?.score ?? 0);
    expect(result.issues.find((i) => i.key === 'D-4')?.score).toBe(0);
    const d3 = result.issues.find((i) => i.key === 'D-3');
    expect(d3?.signals.map((s) => s.kind).sort()).toEqual(['blocked', 'blocker_chain', 'overdue']);
  });

  it('builds explainable findings with suggested actions', () => {
    const kinds = new Set(result.findings.map((f) => f.kind));
    for (const k of ['blocked', 'blocker_chain', 'stale', 'overdue', 'missing_acceptance_criteria', 'unanswered_question', 'scope_creep', 'unassigned'])
      expect(kinds.has(k as never)).toBe(true);
    const chain = result.findings.find((f) => f.id === 'blocker_chain:D-1>D-2>D-3');
    expect(chain?.explanation).toContain('D-1 → D-2 → D-3');
    const keystone = result.findings.find((f) => f.id === 'keystone:D-1');
    expect(keystone?.suggestedActions[0]?.action).toBe('add-risk-label');
    const creep = result.findings.find((f) => f.id === 'scope_creep:sprint');
    expect(creep?.title).toContain('%');
    for (const f of result.findings) expect(f.evidence.length).toBeGreaterThan(0);
    // sorted by severity
    const rank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
    for (let i = 1; i < result.findings.length; i++) expect(rank[result.findings[i - 1]!.severity]).toBeGreaterThanOrEqual(rank[result.findings[i]!.severity]);
  });

  it('reports overloaded people as findings', () => {
    const r = analyzeSprint(input([...demoIssues(), issue({ key: 'D-7', assignee: alice, storyPoints: 13 })]));
    const f = r.findings.find((x) => x.kind === 'overloaded_assignee');
    expect(f?.title).toBe('Alice is overloaded');
    expect(f?.suggestedActions[0]?.issueKey).toBeDefined();
  });

  it('returns no_data instead of inventing a score for empty sprints', () => {
    const r = analyzeSprint(input([]));
    expect(r.status).toBe('no_data');
    expect(r.riskScore).toBeNull();
    expect(r.message).toContain('has no issues');
  });

  it('lowers confidence when data is thin', () => {
    const r = analyzeSprint(
      input([issue({ key: 'D-1', changelogAvailable: false, commentsTotal: 30 })], {
        sprint: { ...sprint, startDate: undefined, endDate: undefined },
        graph: { available: false, source: 'teamwork-graph', note: 'scope not granted', people: {} },
        dataNotes: ['Changelog truncated on 1 issue.'],
      }),
    );
    expect(r.confidence.level).toBe('low');
    expect(r.confidence.reasons.join(' ')).toContain('small sample');
    expect(r.confidence.reasons.join(' ')).toContain('Teamwork Graph context unavailable (scope not granted)');
    expect(r.components.find((c) => c.name === 'Burn-down gap')?.detail).toContain('No sprint dates');
    expect(r.metrics.daysRemaining).toBeNull();
  });

  it('reports full confidence for complete data', () => {
    const many = Array.from({ length: 6 }, (_, n) => issue({ key: `D-${n}`, storyPoints: 1 }));
    expect(analyzeSprint(input(many)).confidence.reasons[0]).toContain('Complete data');
  });

  it('detects cycles at sprint level', () => {
    const r = analyzeSprint(input([
      issue({ key: 'D-1', links: [{ relation: 'blockedBy', key: 'D-2', statusCategory: 'new' }] }),
      issue({ key: 'D-2', links: [{ relation: 'blockedBy', key: 'D-1', statusCategory: 'new' }] }),
    ]));
    expect(r.findings[0]?.kind).toBe('circular_dependency');
    expect(r.band).not.toBeNull();
  });

  it('uses issue counts when estimates are missing', () => {
    const r = analyzeSprint(input([issue({ key: 'D-1' }), issue({ key: 'D-2', addedToSprintAt: '2026-11-19T00:00:00Z' })]));
    expect(r.components.find((c) => c.name === 'Scope creep')?.detail).toContain('issues');
    expect(r.findings.find((f) => f.id === 'scope_creep:sprint')?.title).toContain('by issues');
  });
});

describe('summaries', () => {
  const result = analyzeSprint(input(demoIssues()));
  it('summarizes compactly for agents', () => {
    const trend = computeTrend(toSnapshot(result), []);
    const s = summarizeForAgent(result, trend, 3, 2);
    expect(s.topFindings).toHaveLength(3);
    expect(s.topIssues).toHaveLength(2);
    expect(s.trend?.direction).toBe('unknown');
    expect(s.instructions).toContain('explicit user confirmation');
    expect(s.sprint.goal).toBe('Ship checkout v2');
    expect(summarizeForAgent(analyzeSprint(input([]))).message).toContain('no issues');
  });
  it('explains a single issue or says it is not in the sprint', () => {
    const e = explainIssue(result, 'd-3');
    expect(e.found).toBe(true);
    expect(e.issue?.findings.length).toBeGreaterThan(0);
    expect(e.sprintContext?.of).toBe(6);
    expect(explainIssue(result, 'X-1')).toMatchObject({ found: false });
  });
});
