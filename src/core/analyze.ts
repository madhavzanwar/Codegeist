import { buildBlockerGraph } from './graph';
import type { DetectorContext } from './signals';
import {
  computeAssigneeLoad,
  detectBlocked,
  detectBlockerChains,
  detectDueDates,
  detectMissingAcceptanceCriteria,
  detectOverload,
  detectScopeCreep,
  detectStale,
  detectUnansweredQuestion,
  detectUnassigned,
  isDone,
  scopeStatus,
} from './signals';
import { daysBetween, elapsedFraction, parseDate } from './time';
import type {
  AnalysisInput,
  AssigneeLoad,
  Confidence,
  ConfidenceReport,
  Finding,
  IssueRecord,
  IssueRisk,
  ScoreComponent,
  Severity,
  Signal,
  SignalKind,
  SprintMetrics,
  SprintRiskResult,
  SuggestedAction,
} from './types';

export function bandFor(score: number): Severity {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function maxSeverity(values: Severity[]): Severity {
  return values.reduce<Severity>((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a), 'low');
}

export function minConfidence(values: Confidence[]): Confidence {
  return values.reduce<Confidence>((a, b) => (CONFIDENCE_RANK[b] < CONFIDENCE_RANK[a] ? b : a), 'high');
}

/** Later in the sprint, the same open problem is riskier. */
export function timeFactor(elapsed: number | null): number {
  return elapsed === null ? 1 : 0.85 + 0.3 * elapsed;
}

export function scoreIssue(signals: Signal[], elapsed: number | null): number {
  const raw = signals.reduce((sum, s) => sum + s.points, 0);
  return Math.min(100, Math.round(raw * timeFactor(elapsed)));
}

function computeMetrics(input: AnalysisInput, elapsed: number | null): SprintMetrics {
  const { issues, sprint, now } = input;
  const end = parseDate(sprint.endDate);
  let committedIssues = 0;
  let addedIssues = 0;
  let committedPoints = 0;
  let addedPoints = 0;
  for (const i of issues) {
    const s = scopeStatus(i, sprint);
    if (s.added) {
      addedIssues++;
      addedPoints += i.storyPoints ?? 0;
    } else {
      committedIssues++;
      committedPoints += i.storyPoints ?? 0;
    }
  }
  const done = issues.filter(isDone);
  const totalPoints = issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const donePoints = done.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  return {
    totalIssues: issues.length,
    doneIssues: done.length,
    totalPoints,
    donePoints,
    remainingPoints: totalPoints - donePoints,
    estimatedIssues: issues.filter((i) => i.storyPoints !== undefined).length,
    elapsedFraction: elapsed,
    daysRemaining: end ? Math.max(0, Math.round(daysBetween(now, end) * 10) / 10) : null,
    committedIssues,
    addedIssues,
    committedPoints,
    addedPoints,
    blockedIssues: 0,
  };
}

function computeConfidence(input: AnalysisInput, metrics: SprintMetrics, elapsed: number | null): ConfidenceReport {
  let score = 1;
  const reasons: string[] = [];
  const n = input.issues.length;
  if (n < 5) {
    score -= 0.3;
    reasons.push(`Only ${n} issue${n === 1 ? '' : 's'} in the sprint — small sample.`);
  }
  const estimateCoverage = n ? metrics.estimatedIssues / n : 0;
  if (estimateCoverage < 0.5) {
    score -= 0.2;
    reasons.push(`${Math.round(estimateCoverage * 100)}% of issues have story points; load and burn-down use issue counts where points are missing.`);
  } else if (estimateCoverage < 0.9) {
    score -= 0.05;
    reasons.push(`${Math.round(estimateCoverage * 100)}% of issues have story points.`);
  }
  if (elapsed === null) {
    score -= 0.15;
    reasons.push('Sprint has no start/end dates, so time-based signals (burn-down gap) are disabled.');
  }
  const noChangelog = input.issues.filter((i) => !i.changelogAvailable).length;
  if (noChangelog > 0) {
    score -= noChangelog / Math.max(1, n) > 0.5 ? 0.15 : 0.05;
    reasons.push(`Changelog unavailable for ${noChangelog} issue${noChangelog === 1 ? '' : 's'}; scope creep falls back to creation dates there.`);
  }
  const truncated = input.issues.filter((i) => i.commentsTotal > i.comments.length).length;
  if (truncated > 0) {
    score -= 0.05;
    reasons.push(`Only the latest comments were read on ${truncated} issue${truncated === 1 ? '' : 's'}.`);
  }
  if (input.graph && !input.graph.available) {
    reasons.push(`Teamwork Graph context unavailable${input.graph.note ? ` (${input.graph.note})` : ''}; load analysis uses this sprint only.`);
  }
  for (const note of input.dataNotes ?? []) reasons.push(note);
  score = Math.max(0, Math.min(1, score));
  const level: Confidence = score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low';
  if (reasons.length === 0) reasons.push('Complete data: dates, estimates, changelog and comments were all available.');
  return { level, score: Math.round(score * 100) / 100, reasons };
}

const KIND_TITLES: Record<SignalKind, string> = {
  blocked: 'Blocked work',
  blocker_chain: 'Blocker chain',
  circular_dependency: 'Circular dependency',
  stale: 'Stale in-progress work',
  overdue: 'Overdue',
  due_soon_not_started: 'Due soon, not started',
  missing_acceptance_criteria: 'Missing acceptance criteria',
  unanswered_question: 'Unanswered question',
  scope_creep: 'Scope creep since sprint start',
  overloaded_assignee: 'Overloaded assignee',
  unassigned: 'Unassigned work',
};

export function kindTitle(kind: SignalKind): string {
  return KIND_TITLES[kind];
}

function suggest(kind: SignalKind, issueKey: string, issue?: IssueRecord): SuggestedAction[] {
  switch (kind) {
    case 'blocked':
      return [
        ...(issue && !issue.flagged ? [{ action: 'flag-issue' as const, issueKey, reason: 'Make the impediment visible on the board.' }] : []),
        { action: 'add-risk-comment', issueKey, reason: 'Ask the blocker owner for an ETA.' },
      ];
    case 'blocker_chain':
    case 'circular_dependency':
      return [{ action: 'add-risk-label', issueKey, reason: 'Label as a dependency risk so it is triaged in stand-up.' }];
    case 'stale':
      return [{ action: 'add-risk-comment', issueKey, reason: 'Ask the assignee for a status update.' }];
    case 'overdue':
    case 'due_soon_not_started':
      return [
        { action: 'add-risk-label', issueKey, reason: 'Mark as at risk.' },
        { action: 'add-risk-comment', issueKey, reason: 'Agree a new date or de-scope.' },
      ];
    case 'missing_acceptance_criteria':
      return [{ action: 'create-followup-subtask', issueKey, reason: 'Create a subtask to define acceptance criteria.' }];
    case 'unanswered_question':
      return [{ action: 'add-risk-comment', issueKey, reason: 'Nudge the right person to answer the open question.' }];
    case 'scope_creep':
      return [{ action: 'add-risk-label', issueKey, reason: 'Label as added mid-sprint for the retro.' }];
    case 'overloaded_assignee':
      return [{ action: 'add-risk-comment', issueKey, reason: 'Propose re-balancing this item to someone with capacity.' }];
    case 'unassigned':
      return [{ action: 'add-risk-comment', issueKey, reason: 'Ask the team lead to assign an owner.' }];
  }
}

function buildFindings(
  signals: Signal[],
  byKey: Map<string, IssueRecord>,
  loads: AssigneeLoad[],
  metrics: SprintMetrics,
  chains: string[][],
  cycles: string[][],
): Finding[] {
  const findings: Finding[] = [];
  const perIssueKinds: SignalKind[] = ['blocked', 'overdue', 'due_soon_not_started', 'unanswered_question', 'stale'];
  for (const s of signals.filter((x) => perIssueKinds.includes(x.kind))) {
    findings.push({
      id: `${s.kind}:${s.issueKey}`,
      kind: s.kind,
      severity: s.severity,
      confidence: s.confidence,
      title: `${KIND_TITLES[s.kind]}: ${s.issueKey}`,
      explanation: s.message,
      issueKeys: [s.issueKey],
      evidence: s.evidence,
      suggestedActions: suggest(s.kind, s.issueKey, byKey.get(s.issueKey)),
    });
  }

  for (const chain of chains) {
    const head = chain[0] as string;
    findings.push({
      id: `blocker_chain:${chain.join('>')}`,
      kind: 'blocker_chain',
      severity: chain.length - 1 >= 3 ? 'high' : 'medium',
      confidence: 'high',
      title: `Blocker chain of ${chain.length - 1} hops ending at ${chain[chain.length - 1]}`,
      explanation: `${chain.join(' → ')}: each issue waits on the previous one, so ${head} must finish first.`,
      issueKeys: chain,
      evidence: [{ label: 'Chain', value: chain.join(' → ') }],
      suggestedActions: byKey.has(head) ? suggest('blocker_chain', head) : [],
    });
  }
  for (const s of signals.filter((x) => x.kind === 'blocker_chain' && x.message.includes('keystone'))) {
    findings.push({
      id: `keystone:${s.issueKey}`,
      kind: 'blocker_chain',
      severity: s.severity,
      confidence: 'high',
      title: `Keystone blocker: ${s.issueKey}`,
      explanation: s.message,
      issueKeys: [s.issueKey],
      evidence: s.evidence,
      suggestedActions: suggest('blocker_chain', s.issueKey),
    });
  }
  for (const cycle of cycles) {
    findings.push({
      id: `circular_dependency:${cycle.join('>')}`,
      kind: 'circular_dependency',
      severity: 'critical',
      confidence: 'high',
      title: `Circular dependency between ${cycle.join(', ')}`,
      explanation: `${cycle.join(', ')} block each other, so none of them can be completed first. Break one link.`,
      issueKeys: cycle,
      evidence: [{ label: 'Cycle', value: cycle.join(' → ') }],
      suggestedActions: cycle.filter((k) => byKey.has(k)).slice(0, 1).flatMap((k) => suggest('circular_dependency', k)),
    });
  }

  const grouped = (kind: SignalKind, title: (n: number) => string, explain: (keys: string[]) => string) => {
    const list = signals.filter((s) => s.kind === kind);
    if (!list.length) return;
    const keys = list.map((s) => s.issueKey);
    findings.push({
      id: `${kind}:group`,
      kind,
      severity: maxSeverity(list.map((s) => s.severity)),
      confidence: minConfidence(list.map((s) => s.confidence)),
      title: title(keys.length),
      explanation: explain(keys),
      issueKeys: keys,
      evidence: list
        .map((s) => ({ label: s.issueKey, value: s.evidence.map((e) => `${e.label}: ${e.value}`).join('; '), issueKey: s.issueKey }))
        .slice(0, 20),
      suggestedActions: keys.slice(0, 5).flatMap((k) => suggest(kind, k, byKey.get(k))),
    });
  };

  grouped(
    'missing_acceptance_criteria',
    (n) => `${n} issue${n > 1 ? 's' : ''} without acceptance criteria`,
    (keys) => `${keys.join(', ')} have no recognisable acceptance criteria, which makes "done" ambiguous and invites rework.`,
  );
  grouped(
    'unassigned',
    (n) => `${n} unassigned issue${n > 1 ? 's' : ''} in the active sprint`,
    (keys) => `${keys.join(', ')} have no owner.`,
  );

  const creep = signals.filter((s) => s.kind === 'scope_creep');
  if (metrics.addedIssues > 0) {
    const pct = metrics.committedPoints > 0 ? Math.round((metrics.addedPoints / metrics.committedPoints) * 100) : null;
    const pctIssues = metrics.committedIssues > 0 ? Math.round((metrics.addedIssues / metrics.committedIssues) * 100) : null;
    const severity: Severity = (pct ?? pctIssues ?? 0) >= 30 ? 'high' : (pct ?? pctIssues ?? 0) >= 15 ? 'medium' : 'low';
    const keys = creep.map((s) => s.issueKey);
    findings.push({
      id: 'scope_creep:sprint',
      kind: 'scope_creep',
      severity,
      confidence: minConfidence(creep.length ? creep.map((s) => s.confidence) : ['high']),
      title: `Scope grew ${pct !== null ? `${pct}% by points` : `${pctIssues ?? 0}% by issues`} since sprint start`,
      explanation: `${metrics.addedIssues} issue${metrics.addedIssues > 1 ? 's' : ''} (${metrics.addedPoints} pts) were added after the sprint started, on top of ${metrics.committedIssues} committed issues (${metrics.committedPoints} pts).`,
      issueKeys: keys,
      evidence: [
        { label: 'Committed issues', value: metrics.committedIssues },
        { label: 'Committed points', value: metrics.committedPoints },
        { label: 'Added issues', value: metrics.addedIssues },
        { label: 'Added points', value: metrics.addedPoints },
        ...creep.flatMap((s) => s.evidence.filter((e) => e.issueKey)).slice(0, 15),
      ],
      suggestedActions: keys.slice(0, 5).flatMap((k) => suggest('scope_creep', k)),
    });
  }

  for (const load of loads.filter((l) => l.overloaded)) {
    const keys = signals.filter((s) => s.kind === 'overloaded_assignee' && byKey.get(s.issueKey)?.assignee?.accountId === load.accountId).map((s) => s.issueKey);
    const heaviest = keys
      .map((k) => byKey.get(k) as IssueRecord)
      .sort((a, b) => (b.storyPoints ?? 0) - (a.storyPoints ?? 0))[0];
    findings.push({
      id: `overloaded_assignee:${load.accountId}`,
      kind: 'overloaded_assignee',
      severity: load.reasons.length >= 2 ? 'high' : 'medium',
      confidence: load.reasons.some((r) => r.includes('story points')) ? 'high' : 'medium',
      title: `${load.displayName} is overloaded`,
      explanation: `${load.displayName}: ${load.reasons.join('; ')}.`,
      issueKeys: keys,
      evidence: [
        { label: 'Open issues', value: load.openIssues },
        { label: 'In progress', value: load.inProgress },
        { label: 'Remaining points', value: load.remainingPoints },
        ...(load.openWorkElsewhere !== undefined
          ? [{ label: 'Open work elsewhere (Teamwork Graph)', value: `${load.openWorkElsewhere}${load.openWorkElsewhereCapped ? '+' : ''}` }]
          : []),
        ...(load.teams.length ? [{ label: 'Teams (Teamwork Graph)', value: load.teams.join(', ') }] : []),
      ],
      suggestedActions: heaviest ? suggest('overloaded_assignee', heaviest.key) : [],
    });
  }

  return findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.issueKeys.length - a.issueKeys.length || a.id.localeCompare(b.id),
  );
}

function computeComponents(issueRisks: IssueRisk[], metrics: SprintMetrics, elapsed: number | null): ScoreComponent[] {
  const open = issueRisks.filter((r) => r.statusCategory !== 'done');
  const weightOf = (r: IssueRisk) => Math.max(1, r.storyPoints ?? 1);
  const totalW = open.reduce((s, r) => s + weightOf(r), 0);
  const weightedRisk = totalW ? open.reduce((s, r) => s + r.score * weightOf(r), 0) / totalW : 0;

  const usePoints = metrics.totalPoints > 0 && metrics.estimatedIssues / Math.max(1, metrics.totalIssues) >= 0.5;
  const doneFrac = usePoints
    ? metrics.donePoints / Math.max(1, metrics.totalPoints)
    : metrics.doneIssues / Math.max(1, metrics.totalIssues);
  const gap = elapsed === null ? 0 : Math.max(0, elapsed - doneFrac);
  const burn = Math.min(100, gap * 200);

  const creepFrac = usePoints
    ? metrics.addedPoints / Math.max(1, metrics.committedPoints)
    : metrics.addedIssues / Math.max(1, metrics.committedIssues);
  const creep = Math.min(100, (creepFrac / 0.3) * 100);

  const blockedW = open.filter((r) => r.signals.some((s) => s.kind === 'blocked' || s.kind === 'circular_dependency')).reduce((s, r) => s + weightOf(r), 0);
  const blocked = totalW ? Math.min(100, (blockedW / totalW / 0.4) * 100) : 0;

  return [
    { name: 'Issue risk', weight: 0.4, value: Math.round(weightedRisk), detail: `Effort-weighted mean risk of ${open.length} open issues.` },
    {
      name: 'Burn-down gap',
      weight: 0.25,
      value: Math.round(burn),
      detail:
        elapsed === null
          ? 'No sprint dates — not scored.'
          : `${Math.round(elapsed * 100)}% of time elapsed vs ${Math.round(doneFrac * 100)}% of ${usePoints ? 'points' : 'issues'} done.`,
    },
    {
      name: 'Scope creep',
      weight: 0.15,
      value: Math.round(creep),
      detail: `${Math.round(creepFrac * 100)}% ${usePoints ? 'points' : 'issues'} added after start (30% = max).`,
    },
    {
      name: 'Blocked work',
      weight: 0.2,
      value: Math.round(blocked),
      detail: `${totalW ? Math.round((blockedW / totalW) * 100) : 0}% of remaining effort is blocked (40% = max).`,
    },
  ];
}

/** Main entry point: analyse a sprint and return a fully explainable risk result. */
export function analyzeSprint(input: AnalysisInput): SprintRiskResult {
  const { now, sprint, issues, settings } = input;
  const elapsed = elapsedFraction(sprint.startDate, sprint.endDate, now);
  const metrics = computeMetrics(input, elapsed);
  const confidence = computeConfidence(input, metrics, elapsed);
  const base = {
    generatedAt: now.toISOString(),
    project: input.project,
    sprint,
    graph: { used: !!input.graph?.available, ...(input.graph?.note ? { note: input.graph.note } : {}) },
    dataNotes: input.dataNotes ?? [],
  };

  if (issues.length === 0) {
    return {
      ...base,
      status: 'no_data',
      message: `Sprint "${sprint.name}" has no issues in Jira, so there is nothing to score. Add issues to the sprint or pick another sprint.`,
      riskScore: null,
      healthScore: null,
      band: null,
      components: [],
      metrics,
      confidence: { level: 'low', score: 0, reasons: ['No issues found in this sprint.'] },
      findings: [],
      issues: [],
      assignees: [],
    };
  }

  const byKey = new Map(issues.map((i) => [i.key, i]));
  const graph = buildBlockerGraph(issues);
  const ctx: DetectorContext = { now, sprint, settings, graph, byKey };
  const loads = computeAssigneeLoad(issues, settings, input.graph);
  const chainResult = detectBlockerChains(ctx);

  const signals: Signal[] = [...chainResult.signals];
  for (const issue of issues) {
    signals.push(
      ...detectBlocked(issue, ctx),
      ...detectStale(issue, ctx),
      ...detectDueDates(issue, ctx),
      ...detectMissingAcceptanceCriteria(issue),
      ...detectUnansweredQuestion(issue, ctx),
      ...detectScopeCreep(issue, ctx),
      ...detectUnassigned(issue, ctx),
      ...detectOverload(issue, loads),
    );
  }

  const issueRisks: IssueRisk[] = issues
    .map((i) => {
      const own = isDone(i) ? [] : signals.filter((s) => s.issueKey === i.key);
      const score = scoreIssue(own, elapsed);
      return {
        key: i.key,
        summary: i.summary,
        status: i.status,
        statusCategory: i.statusCategory,
        assignee: i.assignee?.displayName ?? null,
        ...(i.storyPoints !== undefined ? { storyPoints: i.storyPoints } : {}),
        score,
        band: bandFor(score),
        signals: own,
      };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  metrics.blockedIssues = issueRisks.filter((r) => r.signals.some((s) => s.kind === 'blocked')).length;
  const components = computeComponents(issueRisks, metrics, elapsed);
  const riskScore = Math.round(components.reduce((s, c) => s + c.weight * c.value, 0));
  const liveSignals = signals.filter((s) => !isDone(byKey.get(s.issueKey) as IssueRecord));

  return {
    ...base,
    status: 'ok',
    riskScore,
    healthScore: 100 - riskScore,
    band: bandFor(riskScore),
    components,
    metrics,
    confidence,
    findings: buildFindings(liveSignals, byKey, loads, metrics, chainResult.chains, chainResult.cycles),
    issues: issueRisks,
    assignees: loads,
  };
}
