import type { Finding, IssueRisk, SprintRiskResult, TrendReport } from './types';

/**
 * Compact, LLM-friendly views of a SprintRiskResult for Rovo actions and MCP tools.
 * Keeps payloads small while preserving every piece of evidence the agent needs to explain itself.
 */

export interface AgentSprintSummary {
  status: SprintRiskResult['status'];
  message?: string;
  project: string;
  sprint: { id: number; name: string; state: string; startDate?: string; endDate?: string; goal?: string };
  riskScore: number | null;
  healthScore: number | null;
  band: string | null;
  confidence: { level: string; reasons: string[] };
  scoreBreakdown: Array<{ component: string; weight: string; risk: number; detail: string }>;
  metrics: SprintRiskResult['metrics'];
  topFindings: Array<Pick<Finding, 'id' | 'kind' | 'severity' | 'confidence' | 'title' | 'explanation' | 'issueKeys' | 'evidence' | 'suggestedActions'>>;
  topIssues: Array<{ key: string; summary: string; score: number; band: string; status: string; assignee: string | null; why: string[] }>;
  overloadedAssignees: Array<{ name: string; reasons: string[] }>;
  trend?: { direction: string; riskDelta: number | null; previousAt?: string; newAtRisk: string[]; noLongerAtRisk: string[] };
  teamworkGraph: { used: boolean; note?: string };
  instructions: string;
}

const AGENT_INSTRUCTIONS =
  'Report only what is in this payload. Quote issue keys, dates and counts from `evidence`. ' +
  'State the confidence level and its reasons. Write actions require a preview first and explicit user confirmation.';

export function summarizeForAgent(result: SprintRiskResult, trend?: TrendReport, maxFindings = 10, maxIssues = 10): AgentSprintSummary {
  return {
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
    project: `${result.project.name} (${result.project.key})`,
    sprint: {
      id: result.sprint.id,
      name: result.sprint.name,
      state: result.sprint.state,
      ...(result.sprint.startDate ? { startDate: result.sprint.startDate } : {}),
      ...(result.sprint.endDate ? { endDate: result.sprint.endDate } : {}),
      ...(result.sprint.goal ? { goal: result.sprint.goal } : {}),
    },
    riskScore: result.riskScore,
    healthScore: result.healthScore,
    band: result.band,
    confidence: { level: result.confidence.level, reasons: result.confidence.reasons },
    scoreBreakdown: result.components.map((c) => ({ component: c.name, weight: `${Math.round(c.weight * 100)}%`, risk: c.value, detail: c.detail })),
    metrics: result.metrics,
    topFindings: result.findings.slice(0, maxFindings).map((f) => ({
      id: f.id,
      kind: f.kind,
      severity: f.severity,
      confidence: f.confidence,
      title: f.title,
      explanation: f.explanation,
      issueKeys: f.issueKeys.slice(0, 15),
      evidence: f.evidence.slice(0, 10),
      suggestedActions: f.suggestedActions.slice(0, 3),
    })),
    topIssues: result.issues
      .filter((i) => i.score > 0)
      .slice(0, maxIssues)
      .map((i) => ({ key: i.key, summary: i.summary, score: i.score, band: i.band, status: i.status, assignee: i.assignee, why: i.signals.map((s) => s.message) })),
    overloadedAssignees: result.assignees.filter((a) => a.overloaded).map((a) => ({ name: a.displayName, reasons: a.reasons })),
    ...(trend
      ? {
          trend: {
            direction: trend.direction,
            riskDelta: trend.riskDelta,
            ...(trend.previousAt ? { previousAt: trend.previousAt } : {}),
            newAtRisk: trend.newAtRisk,
            noLongerAtRisk: trend.noLongerAtRisk,
          },
        }
      : {}),
    teamworkGraph: result.graph,
    instructions: AGENT_INSTRUCTIONS,
  };
}

export interface IssueExplanation {
  found: boolean;
  message?: string;
  issue?: IssueRisk & { findings: string[] };
  sprintContext?: { sprint: string; sprintRisk: number | null; rank: number; of: number };
}

export function explainIssue(result: SprintRiskResult, key: string): IssueExplanation {
  const upper = key.toUpperCase();
  const idx = result.issues.findIndex((i) => i.key === upper);
  if (idx < 0) {
    return { found: false, message: `${upper} is not in sprint "${result.sprint.name}", so it has no sprint risk score. No data was invented.` };
  }
  const issue = result.issues[idx] as IssueRisk;
  return {
    found: true,
    issue: { ...issue, findings: result.findings.filter((f) => f.issueKeys.includes(upper)).map((f) => f.title) },
    sprintContext: { sprint: result.sprint.name, sprintRisk: result.riskScore, rank: idx + 1, of: result.issues.length },
  };
}
