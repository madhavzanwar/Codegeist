import { describe, expect, it } from 'vitest';
import { analyzeSprint } from '../src/core/analyze';
import { buildReportStorage, escapeXml, reportTitle } from '../src/core/report';
import { appendSnapshot, computeTrend, toSnapshot } from '../src/core/trend';
import type { Snapshot } from '../src/core/types';
import { input, issue } from './fixtures';

const snap = (at: string, riskScore: number | null, issueScores: Record<string, number> = {}, sprintId = 7): Snapshot => ({
  at, sprintId, sprintName: 'S', riskScore, healthScore: riskScore === null ? null : 100 - riskScore,
  findingCounts: { blocked: 1 }, issueScores, remainingPoints: 0, doneIssues: 0, totalIssues: 1,
});

describe('trend', () => {
  it('compares with the previous run of the same sprint', () => {
    const t = computeTrend(snap('2026-11-20T00:00:00Z', 70, { A: 80, B: 10 }), [
      snap('2026-11-18T00:00:00Z', 40, { B: 70 }),
      snap('2026-11-19T00:00:00Z', 50, { B: 65, C: 61 }),
      snap('2026-11-19T12:00:00Z', 10, {}, 99),
    ]);
    expect(t).toMatchObject({ hasPrevious: true, riskDelta: 20, direction: 'worsening', newAtRisk: ['A'], noLongerAtRisk: ['B', 'C'] });
    expect(t.history.map((h) => h.riskScore)).toEqual([40, 50, 70]);
  });
  it('handles improving, stable, null and finding deltas', () => {
    const cur = { ...snap('2026-11-20T00:00:00Z', 30), findingCounts: { stale: 2 } };
    const t = computeTrend(cur, [snap('2026-11-19T00:00:00Z', 50)]);
    expect(t.direction).toBe('improving');
    expect(t.findingCountDeltas).toEqual({ stale: 2, blocked: -1 });
    expect(computeTrend(snap('2026-11-20T00:00:00Z', 51), [snap('2026-11-19T00:00:00Z', 50)]).direction).toBe('stable');
    expect(computeTrend(snap('2026-11-20T00:00:00Z', null), [snap('2026-11-19T00:00:00Z', 50)]).direction).toBe('unknown');
  });
  it('appends with dedupe and cap', () => {
    let h: Snapshot[] = [];
    h = appendSnapshot(h, snap('2026-11-20T00:00:00Z', 1));
    h = appendSnapshot(h, snap('2026-11-20T00:01:00Z', 2));
    expect(h).toHaveLength(1);
    expect(h[0]?.riskScore).toBe(2);
    for (let i = 1; i <= 40; i++) h = appendSnapshot(h, snap(`2026-11-2${Math.floor(i / 20) + 1}T${String(i % 20).padStart(2, '0')}:00:00Z`, i));
    expect(h.length).toBe(30);
  });
});

describe('report', () => {
  it('escapes XML', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('renders a storage-format page with table, trend and evidence', () => {
    const result = analyzeSprint(input([
      issue({ key: 'D-1', summary: 'Pay <now>', dueDate: '2026-11-18', storyPoints: 20 }),
      issue({ key: 'D-2', statusCategory: 'done', storyPoints: 1 }),
    ]));
    const prev = snap('2026-11-19T00:00:00Z', 10, {});
    const trend = computeTrend(toSnapshot(result), [prev]);
    const html = buildReportStorage(result, trend, 'https://acme.atlassian.net/');
    expect(html).toContain('<h2>Top risks</h2>');
    expect(html).toContain('href="https://acme.atlassian.net/browse/D-1"');
    expect(html).toContain('Pay &lt;now&gt;');
    expect(html).toContain('Trend vs last run');
    expect(html).toContain('▲ +');
    expect(html).toContain('OVERLOADED');
    expect(html).toContain('ac:name="status"');
    expect(reportTitle(result)).toMatch(/^Sprint Risk Report — DEMO — Sprint 7 — 2026-11-20 12:00 UTC$/);
  });
  it('renders first-run, no-risk and no-data variants', () => {
    const calm = analyzeSprint(input([issue({ key: 'D-1', statusCategory: 'done' })]));
    const html = buildReportStorage(calm, computeTrend(toSnapshot(calm), []));
    expect(html).toContain('first recorded run');
    expect(html).toContain('No open issue currently carries a risk signal');
    const empty = analyzeSprint(input([]));
    expect(buildReportStorage(empty, computeTrend(toSnapshot(empty), []))).toContain('has no issues');
  });
});
