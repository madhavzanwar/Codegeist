import type { BlockerGraph } from './graph';
import { findChains, findCycles, openBlockers, openDependents } from './graph';
import { expectsAcceptanceCriteria, findUnansweredQuestion, hasAcceptanceCriteria } from './text';
import { formatAge, hoursBetween, parseDate, daysBetween } from './time';
import type { AssigneeLoad, GraphContext, IssueRecord, Settings, Signal, SprintInfo } from './types';

/**
 * Signal detectors. Each returns zero or more Signals bound to a single issue,
 * with the evidence (keys, dates, counts) that justifies it. Nothing is inferred
 * without a datum from Jira behind it.
 */

export interface DetectorContext {
  now: Date;
  sprint: SprintInfo;
  settings: Settings;
  graph: BlockerGraph;
  byKey: Map<string, IssueRecord>;
}

export const isDone = (i: IssueRecord): boolean => i.statusCategory === 'done';

export function detectBlocked(issue: IssueRecord, ctx: DetectorContext): Signal[] {
  if (isDone(issue)) return [];
  const blockers = openBlockers(ctx.graph, issue.key);
  if (!issue.flagged && blockers.length === 0) return [];
  const outside = blockers.filter((b) => !ctx.graph.inSprint.has(b));
  const evidence = [
    ...(issue.flagged ? [{ label: 'Flagged as impediment', value: 'yes', issueKey: issue.key }] : []),
    ...blockers.map((b) => ({
      label: ctx.graph.inSprint.has(b) ? 'Blocked by (in sprint)' : 'Blocked by (outside sprint)',
      value: b,
      issueKey: b,
    })),
  ];
  const parts: string[] = [];
  if (issue.flagged) parts.push('is flagged as an impediment');
  if (blockers.length) parts.push(`is blocked by ${blockers.length} unresolved issue${blockers.length > 1 ? 's' : ''} (${blockers.join(', ')})`);
  return [
    {
      kind: 'blocked',
      issueKey: issue.key,
      points: 35 + (outside.length ? 10 : 0),
      severity: outside.length || blockers.length > 1 ? 'high' : 'medium',
      confidence: 'high',
      message: `${issue.key} ${parts.join(' and ')}${outside.length ? `; ${outside.join(', ')} ${outside.length > 1 ? 'are' : 'is'} outside this sprint` : ''}.`,
      evidence,
    },
  ];
}

export function detectBlockerChains(ctx: DetectorContext): { chains: string[][]; cycles: string[][]; signals: Signal[] } {
  const chains = findChains(ctx.graph);
  const cycles = findCycles(ctx.graph);
  const signals: Signal[] = [];

  // Depth signal: issues at the end of long chains.
  for (const chain of chains) {
    const tail = chain[chain.length - 1] as string;
    const hops = chain.length - 1;
    signals.push({
      kind: 'blocker_chain',
      issueKey: tail,
      points: Math.min(25, 8 * hops),
      severity: hops >= 3 ? 'high' : 'medium',
      confidence: 'high',
      message: `${tail} sits at the end of a ${hops}-hop blocker chain: ${chain.join(' → ')}.`,
      evidence: [
        { label: 'Chain', value: chain.join(' → ') },
        { label: 'Hops', value: hops },
      ],
    });
  }

  // Keystone signal: open issues that block 2+ open issues.
  for (const key of [...ctx.graph.inSprint].sort()) {
    const issue = ctx.byKey.get(key);
    if (!issue || isDone(issue)) continue;
    const dependents = openDependents(ctx.graph, key);
    if (dependents.length < 2) continue;
    signals.push({
      kind: 'blocker_chain',
      issueKey: key,
      points: Math.min(24, 8 * dependents.length),
      severity: dependents.length >= 3 ? 'high' : 'medium',
      confidence: 'high',
      message: `${key} is a keystone blocker: ${dependents.length} unresolved issues wait on it (${dependents.join(', ')}).`,
      evidence: [
        { label: 'Blocks', value: dependents.join(', ') },
        { label: 'Waiting issues', value: dependents.length },
      ],
    });
  }

  for (const cycle of cycles) {
    for (const key of cycle) {
      if (!ctx.graph.inSprint.has(key)) continue;
      signals.push({
        kind: 'circular_dependency',
        issueKey: key,
        points: 30,
        severity: 'critical',
        confidence: 'high',
        message: `${key} is part of a circular blocker dependency (${cycle.join(' ↔ ')}); none of these can finish first.`,
        evidence: [{ label: 'Cycle', value: cycle.join(' → ') }],
      });
    }
  }
  return { chains, cycles, signals };
}

export function detectStale(issue: IssueRecord, ctx: DetectorContext): Signal[] {
  if (issue.statusCategory !== 'indeterminate') return [];
  const updated = parseDate(issue.updated);
  if (!updated) return [];
  const age = hoursBetween(updated, ctx.now);
  const threshold = ctx.settings.staleAfterHours;
  if (age < threshold) return [];
  const ratio = age / threshold;
  return [
    {
      kind: 'stale',
      issueKey: issue.key,
      points: Math.round(20 + Math.min(15, (ratio - 1) * 10)),
      severity: ratio >= 2 ? 'high' : 'medium',
      confidence: 'high',
      message: `${issue.key} is "${issue.status}" but has had no update for ${formatAge(age)} (threshold ${formatAge(threshold)}).`,
      evidence: [
        { label: 'Last updated', value: issue.updated, issueKey: issue.key },
        { label: 'Status', value: issue.status },
        { label: 'Hours without update', value: Math.round(age) },
      ],
    },
  ];
}

export function detectDueDates(issue: IssueRecord, ctx: DetectorContext): Signal[] {
  if (isDone(issue) || !issue.dueDate) return [];
  const due = parseDate(issue.dueDate);
  if (!due) return [];
  const daysLate = daysBetween(due, ctx.now);
  if (daysLate > 0) {
    const whole = Math.max(1, Math.ceil(daysLate));
    return [
      {
        kind: 'overdue',
        issueKey: issue.key,
        points: 30 + Math.min(15, whole * 3),
        severity: whole > 7 ? 'critical' : 'high',
        confidence: 'high',
        message: `${issue.key} was due on ${issue.dueDate} and is ${whole} day${whole > 1 ? 's' : ''} overdue (status "${issue.status}").`,
        evidence: [
          { label: 'Due date', value: issue.dueDate, issueKey: issue.key },
          { label: 'Days overdue', value: whole },
        ],
      },
    ];
  }
  if (issue.statusCategory === 'new' && -daysLate <= 2) {
    return [
      {
        kind: 'due_soon_not_started',
        issueKey: issue.key,
        points: 15,
        severity: 'medium',
        confidence: 'high',
        message: `${issue.key} is due on ${issue.dueDate} (in ${Math.max(0, Math.round(-daysLate * 24))} hours) and has not been started.`,
        evidence: [
          { label: 'Due date', value: issue.dueDate, issueKey: issue.key },
          { label: 'Status', value: issue.status },
        ],
      },
    ];
  }
  return [];
}

export function detectMissingAcceptanceCriteria(issue: IssueRecord): Signal[] {
  if (isDone(issue) || !expectsAcceptanceCriteria(issue.issueType, issue.isSubtask)) return [];
  if (hasAcceptanceCriteria(issue.descriptionText, issue.hasChecklist)) return [];
  const len = issue.descriptionText.trim().length;
  return [
    {
      kind: 'missing_acceptance_criteria',
      issueKey: issue.key,
      points: len === 0 ? 15 : 12,
      severity: 'medium',
      confidence: 'medium',
      message:
        len === 0
          ? `${issue.key} (${issue.issueType}) has an empty description, so there are no acceptance criteria.`
          : `${issue.key} (${issue.issueType}) has no recognisable acceptance criteria (no "Acceptance criteria" section, checklist or Given/When/Then).`,
      evidence: [
        { label: 'Issue type', value: issue.issueType },
        { label: 'Description length (chars)', value: len },
      ],
    },
  ];
}

export function detectUnansweredQuestion(issue: IssueRecord, ctx: DetectorContext): Signal[] {
  if (isDone(issue)) return [];
  const q = findUnansweredQuestion(issue.comments);
  if (!q) return [];
  const created = parseDate(q.comment.created);
  const age = created ? hoursBetween(created, ctx.now) : 0;
  const t = ctx.settings.unansweredQuestionHours;
  const severity = age >= 3 * t ? 'high' : age >= t ? 'medium' : 'low';
  return [
    {
      kind: 'unanswered_question',
      issueKey: issue.key,
      points: severity === 'high' ? 20 : severity === 'medium' ? 15 : 8,
      severity,
      confidence: 'medium',
      message: `${issue.key} has an unanswered question from ${q.comment.author?.displayName ?? 'an unknown user'} (${formatAge(age)} ago): "${q.excerpt}"`,
      evidence: [
        { label: 'Asked by', value: q.comment.author?.displayName ?? 'unknown' },
        { label: 'Asked at', value: q.comment.created, issueKey: issue.key },
        { label: 'Question', value: q.excerpt },
      ],
    },
  ];
}

/** Baseline after which additions count as scope creep: when the sprint was actually started. */
export function scopeBaseline(sprint: SprintInfo): Date | null {
  return parseDate(sprint.activatedDate) ?? parseDate(sprint.startDate);
}

export interface ScopeStatus {
  added: boolean;
  confidence: 'high' | 'low';
  at?: string;
}

export function scopeStatus(issue: IssueRecord, sprint: SprintInfo): ScopeStatus {
  const baseline = scopeBaseline(sprint);
  if (!baseline || sprint.state === 'future') return { added: false, confidence: 'high' };
  if (issue.changelogAvailable) {
    const at = parseDate(issue.addedToSprintAt);
    if (at && at.getTime() > baseline.getTime()) return { added: true, confidence: 'high', at: issue.addedToSprintAt };
    return { added: false, confidence: 'high' };
  }
  const created = parseDate(issue.created);
  if (created && created.getTime() > baseline.getTime()) return { added: true, confidence: 'low', at: issue.created };
  return { added: false, confidence: 'low' };
}

export function detectScopeCreep(issue: IssueRecord, ctx: DetectorContext): Signal[] {
  const s = scopeStatus(issue, ctx.sprint);
  if (!s.added || isDone(issue)) return [];
  return [
    {
      kind: 'scope_creep',
      issueKey: issue.key,
      points: 10,
      severity: 'low',
      confidence: s.confidence,
      message: `${issue.key} was added to the sprint on ${s.at} — after the sprint started${issue.storyPoints ? ` (+${issue.storyPoints} pts)` : ''}.`,
      evidence: [
        { label: s.confidence === 'high' ? 'Added to sprint' : 'Created (no changelog)', value: s.at ?? 'unknown', issueKey: issue.key },
        ...(issue.storyPoints !== undefined ? [{ label: 'Story points', value: issue.storyPoints }] : []),
      ],
    },
  ];
}

export function detectUnassigned(issue: IssueRecord, ctx: DetectorContext): Signal[] {
  if (isDone(issue) || issue.assignee || ctx.sprint.state !== 'active') return [];
  return [
    {
      kind: 'unassigned',
      issueKey: issue.key,
      points: 8,
      severity: 'low',
      confidence: 'high',
      message: `${issue.key} is in the active sprint but nobody is assigned.`,
      evidence: [{ label: 'Assignee', value: 'none', issueKey: issue.key }],
    },
  ];
}

/** Compute per-person load and decide who is overloaded. */
export function computeAssigneeLoad(issues: IssueRecord[], settings: Settings, graph?: GraphContext): AssigneeLoad[] {
  const map = new Map<string, AssigneeLoad>();
  for (const i of issues) {
    const id = i.assignee?.accountId ?? null;
    const k = id ?? '__unassigned__';
    let load = map.get(k);
    if (!load) {
      const gp = id ? graph?.people[id] : undefined;
      load = {
        accountId: id,
        displayName: i.assignee?.displayName ?? 'Unassigned',
        openIssues: 0,
        inProgress: 0,
        remainingPoints: 0,
        donePoints: 0,
        overloaded: false,
        reasons: [],
        teams: gp?.teams ?? [],
        ...(gp?.openWorkElsewhere !== undefined ? { openWorkElsewhere: gp.openWorkElsewhere, openWorkElsewhereCapped: !!gp.openWorkElsewhereCapped } : {}),
      };
      map.set(k, load);
    }
    if (isDone(i)) {
      load.donePoints += i.storyPoints ?? 0;
    } else {
      load.openIssues += 1;
      load.remainingPoints += i.storyPoints ?? 0;
      if (i.statusCategory === 'indeterminate') load.inProgress += 1;
    }
  }
  const people = [...map.values()].filter((l) => l.accountId);
  const openCounts = people.map((p) => p.openIssues).sort((a, b) => a - b);
  const median = openCounts.length ? (openCounts[Math.floor((openCounts.length - 1) / 2)] as number) : 0;
  for (const p of people) {
    if (p.remainingPoints > settings.maxPointsPerPerson)
      p.reasons.push(`${p.remainingPoints} remaining story points (limit ${settings.maxPointsPerPerson})`);
    if (p.inProgress > settings.maxWipPerPerson) p.reasons.push(`${p.inProgress} issues in progress at once (WIP limit ${settings.maxWipPerPerson})`);
    if (people.length >= 3 && median > 0 && p.openIssues >= Math.max(5, Math.ceil(median * 1.75)))
      p.reasons.push(`${p.openIssues} open issues vs team median ${median}`);
    if (p.openWorkElsewhere !== undefined && p.openWorkElsewhere >= 10)
      p.reasons.push(`${p.openWorkElsewhere}${p.openWorkElsewhereCapped ? '+' : ''} more unresolved work items assigned outside this sprint (Teamwork Graph)`);
    p.overloaded = p.reasons.length > 0;
  }
  return [...map.values()].sort((a, b) => b.remainingPoints - a.remainingPoints || b.openIssues - a.openIssues);
}

/** Attached only to not-yet-started work: that is what can realistically be re-balanced. */
export function detectOverload(issue: IssueRecord, loads: AssigneeLoad[]): Signal[] {
  if (issue.statusCategory !== 'new' || !issue.assignee) return [];
  const load = loads.find((l) => l.accountId === issue.assignee?.accountId);
  if (!load?.overloaded) return [];
  return [
    {
      kind: 'overloaded_assignee',
      issueKey: issue.key,
      points: 10,
      severity: 'medium',
      confidence: load.reasons.some((r) => r.includes('story points')) ? 'high' : 'medium',
      message: `${issue.key} is assigned to ${load.displayName}, who is overloaded: ${load.reasons.join('; ')}.`,
      evidence: [
        { label: 'Assignee', value: load.displayName },
        { label: 'Remaining points', value: load.remainingPoints },
        { label: 'In progress', value: load.inProgress },
      ],
    },
  ];
}
