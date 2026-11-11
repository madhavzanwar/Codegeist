/**
 * Domain types for the Sprint Sentinel risk engine.
 *
 * Everything in src/core is pure: no Forge APIs, no network, no clock reads.
 * The current time is always injected so results are deterministic and testable.
 */

export type StatusCategory = 'new' | 'indeterminate' | 'done';

export interface Person {
  accountId: string;
  displayName: string;
}

export interface CommentRecord {
  id: string;
  author: Person | null;
  created: string; // ISO timestamp
  text: string; // plain text extracted from ADF
}

export interface LinkRecord {
  /** 'blockedBy' => this issue is blocked by `key`; 'blocks' => this issue blocks `key`. */
  relation: 'blocks' | 'blockedBy';
  key: string;
  summary?: string;
  statusCategory: StatusCategory;
}

export interface IssueRecord {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  isSubtask: boolean;
  parentKey?: string;
  status: string;
  statusCategory: StatusCategory;
  priority?: string;
  assignee: Person | null;
  reporter: Person | null;
  created: string;
  updated: string;
  /** Last time the status category changed (Jira `statuscategorychangedate`). */
  statusCategoryChangedAt?: string;
  dueDate?: string; // YYYY-MM-DD
  resolutionDate?: string;
  storyPoints?: number;
  labels: string[];
  flagged: boolean;
  descriptionText: string;
  /** True when the description contains an ADF task list / checklist. */
  hasChecklist: boolean;
  comments: CommentRecord[];
  commentsTotal: number;
  links: LinkRecord[];
  /** When this issue was (last) added to the analysed sprint, from the changelog. */
  addedToSprintAt?: string;
  /** Whether the changelog was available for this issue. */
  changelogAvailable: boolean;
}

export interface SprintInfo {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed';
  startDate?: string;
  endDate?: string;
  activatedDate?: string;
  completeDate?: string;
  goal?: string;
  boardId?: number;
}

export interface ProjectInfo {
  key: string;
  name: string;
}

export interface Settings {
  /** An in-progress issue with no update for this many hours is stale. */
  staleAfterHours: number;
  /** Remaining story points per person before they count as overloaded. */
  maxPointsPerPerson: number;
  /** Concurrent in-progress issues per person before they count as overloaded. */
  maxWipPerPerson: number;
  /** Hours after which an unanswered question becomes medium/high severity. */
  unansweredQuestionHours: number;
}

export const DEFAULT_SETTINGS: Settings = {
  staleAfterHours: 72,
  maxPointsPerPerson: 20,
  maxWipPerPerson: 3,
  unansweredQuestionHours: 24,
};

/** Optional context read from Atlassian Teamwork Graph. */
export interface GraphPersonContext {
  teams: string[];
  /** Unresolved work items assigned to this person outside the analysed sprint (capped by the API page size). */
  openWorkElsewhere?: number;
  /** True when openWorkElsewhere hit the page cap (so the real number may be higher). */
  openWorkElsewhereCapped?: boolean;
}

export interface GraphContext {
  available: boolean;
  source: 'teamwork-graph';
  note?: string;
  people: Record<string, GraphPersonContext>;
}

export interface AnalysisInput {
  now: Date;
  project: ProjectInfo;
  sprint: SprintInfo;
  issues: IssueRecord[];
  settings: Settings;
  graph?: GraphContext;
  /** Notes about data gaps discovered while fetching (e.g. "changelog truncated"). */
  dataNotes?: string[];
}

export type SignalKind =
  | 'blocked'
  | 'blocker_chain'
  | 'circular_dependency'
  | 'stale'
  | 'overdue'
  | 'due_soon_not_started'
  | 'missing_acceptance_criteria'
  | 'unanswered_question'
  | 'scope_creep'
  | 'overloaded_assignee'
  | 'unassigned';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Confidence = 'high' | 'medium' | 'low';

export interface Evidence {
  label: string;
  value: string | number;
  issueKey?: string;
}

export type ActionKey = 'add-risk-comment' | 'add-risk-label' | 'create-followup-subtask' | 'flag-issue';

export interface SuggestedAction {
  action: ActionKey;
  issueKey: string;
  reason: string;
}

export interface Signal {
  kind: SignalKind;
  issueKey: string;
  points: number; // contribution to the issue's risk score before the time factor
  severity: Severity;
  confidence: Confidence;
  message: string;
  evidence: Evidence[];
}

export interface Finding {
  id: string;
  kind: SignalKind;
  severity: Severity;
  confidence: Confidence;
  title: string;
  explanation: string;
  issueKeys: string[];
  evidence: Evidence[];
  suggestedActions: SuggestedAction[];
}

export interface IssueRisk {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  assignee: string | null;
  storyPoints?: number;
  score: number; // 0-100
  band: Severity;
  signals: Signal[];
}

export interface AssigneeLoad {
  accountId: string | null;
  displayName: string;
  openIssues: number;
  inProgress: number;
  remainingPoints: number;
  donePoints: number;
  overloaded: boolean;
  reasons: string[];
  teams: string[];
  openWorkElsewhere?: number;
  openWorkElsewhereCapped?: boolean;
}

export interface ScoreComponent {
  name: string;
  weight: number; // 0-1
  value: number; // 0-100 risk contribution before weighting
  detail: string;
}

export interface SprintMetrics {
  totalIssues: number;
  doneIssues: number;
  totalPoints: number;
  donePoints: number;
  remainingPoints: number;
  estimatedIssues: number;
  elapsedFraction: number | null; // 0..1, null if no sprint dates
  daysRemaining: number | null;
  committedIssues: number;
  addedIssues: number;
  committedPoints: number;
  addedPoints: number;
  blockedIssues: number;
}

export interface ConfidenceReport {
  level: Confidence;
  score: number; // 0..1
  reasons: string[];
}

export interface SprintRiskResult {
  status: 'ok' | 'no_data';
  message?: string;
  generatedAt: string;
  project: ProjectInfo;
  sprint: SprintInfo;
  riskScore: number | null; // 0-100, higher = riskier
  healthScore: number | null; // 100 - riskScore
  band: Severity | null;
  components: ScoreComponent[];
  metrics: SprintMetrics;
  confidence: ConfidenceReport;
  findings: Finding[];
  issues: IssueRisk[]; // sorted by score desc
  assignees: AssigneeLoad[];
  graph: { used: boolean; note?: string };
  dataNotes: string[];
}

export interface Snapshot {
  at: string;
  sprintId: number;
  sprintName: string;
  riskScore: number | null;
  healthScore: number | null;
  findingCounts: Partial<Record<SignalKind, number>>;
  issueScores: Record<string, number>;
  remainingPoints: number;
  doneIssues: number;
  totalIssues: number;
}

export interface TrendReport {
  hasPrevious: boolean;
  previousAt?: string;
  riskDelta: number | null;
  direction: 'improving' | 'worsening' | 'stable' | 'unknown';
  newAtRisk: string[]; // issue keys whose score crossed into high/critical
  noLongerAtRisk: string[];
  findingCountDeltas: Partial<Record<SignalKind, number>>;
  history: Array<{ at: string; riskScore: number | null }>;
}
