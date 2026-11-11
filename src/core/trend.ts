import type { SignalKind, Snapshot, SprintRiskResult, TrendReport } from './types';

export function toSnapshot(result: SprintRiskResult): Snapshot {
  const findingCounts: Partial<Record<SignalKind, number>> = {};
  for (const f of result.findings) findingCounts[f.kind] = (findingCounts[f.kind] ?? 0) + 1;
  const issueScores: Record<string, number> = {};
  for (const i of result.issues.slice(0, 60)) issueScores[i.key] = i.score;
  return {
    at: result.generatedAt,
    sprintId: result.sprint.id,
    sprintName: result.sprint.name,
    riskScore: result.riskScore,
    healthScore: result.healthScore,
    findingCounts,
    issueScores,
    remainingPoints: result.metrics.remainingPoints,
    doneIssues: result.metrics.doneIssues,
    totalIssues: result.metrics.totalIssues,
  };
}

const AT_RISK = 60;

/**
 * Compare the current result against previous snapshots (oldest first).
 * Only snapshots of the same sprint are compared.
 */
export function computeTrend(current: Snapshot, history: Snapshot[]): TrendReport {
  const same = history.filter((h) => h.sprintId === current.sprintId && h.at < current.at).sort((a, b) => a.at.localeCompare(b.at));
  const prev = same[same.length - 1];
  const series = [...same.slice(-13), current].map((s) => ({ at: s.at, riskScore: s.riskScore }));
  if (!prev) {
    return { hasPrevious: false, riskDelta: null, direction: 'unknown', newAtRisk: [], noLongerAtRisk: [], findingCountDeltas: {}, history: series };
  }
  const riskDelta = current.riskScore !== null && prev.riskScore !== null ? current.riskScore - prev.riskScore : null;
  const direction = riskDelta === null ? 'unknown' : riskDelta <= -3 ? 'improving' : riskDelta >= 3 ? 'worsening' : 'stable';
  const newAtRisk = Object.entries(current.issueScores)
    .filter(([k, v]) => v >= AT_RISK && (prev.issueScores[k] ?? 0) < AT_RISK)
    .map(([k]) => k)
    .sort();
  const noLongerAtRisk = Object.entries(prev.issueScores)
    .filter(([k, v]) => v >= AT_RISK && (current.issueScores[k] ?? 0) < AT_RISK)
    .map(([k]) => k)
    .sort();
  const kinds = new Set<SignalKind>([...Object.keys(current.findingCounts), ...Object.keys(prev.findingCounts)] as SignalKind[]);
  const findingCountDeltas: Partial<Record<SignalKind, number>> = {};
  for (const k of kinds) {
    const d = (current.findingCounts[k] ?? 0) - (prev.findingCounts[k] ?? 0);
    if (d !== 0) findingCountDeltas[k] = d;
  }
  return { hasPrevious: true, previousAt: prev.at, riskDelta, direction, newAtRisk, noLongerAtRisk, findingCountDeltas, history: series };
}

/** Keep the most recent `max` snapshots, de-duplicating runs closer than `minGapMs` (keeps the newest). */
export function appendSnapshot(history: Snapshot[], snap: Snapshot, max = 30, minGapMs = 10 * 60_000): Snapshot[] {
  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted[sorted.length - 1];
  if (last && last.sprintId === snap.sprintId && new Date(snap.at).getTime() - new Date(last.at).getTime() < minGapMs) sorted.pop();
  sorted.push(snap);
  return sorted.slice(-max);
}
