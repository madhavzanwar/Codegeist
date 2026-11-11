import { invoke, rovo, router, view } from '@forge/bridge';
import type { SprintRiskResult, TrendReport, IssueRisk, Settings } from '../../../src/core/types';

export type { SprintRiskResult, TrendReport, IssueRisk, Settings };

export interface DashboardData {
  projectKey: string;
  result: SprintRiskResult | null;
  trend: TrendReport | null;
  sprints: Array<{ id: number; name: string; state: string }>;
  settings: Settings & { reportSpaceKey?: string };
  message: string | null;
  lastReport: { pageId: string; title: string; url?: string; at: string } | null;
  siteUrl: string | null;
}

export interface IssuePanelData {
  issueKey: string;
  inSprint: boolean;
  message?: string;
  found?: boolean;
  sprint?: string;
  sprintRisk?: number | null;
  sprintBand?: string | null;
  issue?: IssueRisk & { findings: string[] };
  sprintContext?: { sprint: string; sprintRisk: number | null; rank: number; of: number };
}

export type OpResult =
  | { status: 'confirmation_required'; operation: string; preview: string; confirmationToken: string; expiresInMinutes: number; arguments: Record<string, unknown> }
  | { status: 'done'; operation: string; message: string; details?: { url?: string; key?: string } }
  | { status: 'rejected'; operation: string; message: string };

export interface SeedStepResult {
  ok: boolean;
  progress: number;
  message: string;
  state: { done: boolean; log: string[] };
}

export interface Overview {
  projects: Array<{ projectKey: string; sprintName: string; riskScore: number | null; healthScore: number | null; at: string; history: Array<{ at: string; riskScore: number | null }> }>;
}

// Resolvers return plain JSON; narrow the bridge's InvokeResponse union to the declared shape.
const call = <T,>(fn: string, payload: Record<string, unknown> = {}): Promise<T> => invoke(fn, payload as never) as unknown as Promise<T>;

export const api = {
  dashboard: (sprintId?: number) => call<DashboardData>('getDashboard', sprintId ? { sprintId } : {}),
  issueRisk: () => call<IssuePanelData>('getIssueRisk', {}),
  overview: () => call<Overview>('getOverview', {}),
  saveSettings: (s: Partial<Settings & { reportSpaceKey: string }>) => call<Settings>('saveSettings', s),
  listSpaces: () => call<{ available: boolean; spaces: Array<{ id: string; key: string; name: string }>; message?: string }>('listSpaces', {}),
  operation: (op: string, args: Record<string, unknown>) => call<OpResult>('operation', { op, args }),
  seedStep: (reset = false) => call<SeedStepResult>('seedStep', { reset }),
};

export const AGENT = { agentKey: 'sprint-sentinel-agent', agentName: 'Sprint Sentinel' };

export async function askAgent(prompt: string): Promise<boolean> {
  try {
    if (!(await rovo.isEnabled())) return false;
    await rovo.open({ type: 'forge', ...AGENT, prompt });
    return true;
  } catch {
    return false;
  }
}

export async function openUrl(url: string): Promise<void> {
  try {
    await router.open(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export async function getModuleKey(): Promise<string> {
  try {
    const ctx = (await view.getContext()) as { moduleKey?: string };
    return ctx.moduleKey ?? '';
  } catch {
    return '';
  }
}

export async function enableTheme(): Promise<void> {
  try {
    await view.theme.enable();
  } catch {
    /* not available outside Atlassian */
  }
}
