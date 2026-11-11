import { z } from 'zod';
import { createPending, verifyPending } from './core/confirm';
import { buildReportStorage, reportTitle } from './core/report';
import type { Requester } from './jira/http';
import { ISSUE_KEY_RE, PROJECT_KEY_RE } from './jira/http';
import { addComment, addLabel, createSubtask, getIssueBasics, setFlag } from './jira/service';
import { createPage, getSpaceByKey } from './confluence/service';
import type { Deps } from './service';
import { cachedFieldMap, runAnalysis } from './service';
import { putPending, saveSettings, takePending } from './storage/store';

/**
 * Write operations. Each one is two-phase: preview (returns a single-use confirmation token, writes
 * nothing) then execute (requires the token, the same arguments and the same user).
 */

const issueKey = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => ISSUE_KEY_RE.test(s), 'must be a Jira issue key like ABC-123');
const projectKey = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => PROJECT_KEY_RE.test(s), 'must be a Jira project key like ABC');

export const opSchemas = {
  'add-risk-comment': z.object({ issueKey, comment: z.string().trim().min(3).max(5000) }),
  'add-risk-label': z.object({
    issueKey,
    label: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.:-]{1,100}$/, 'labels cannot contain spaces')
      .default('sentinel-at-risk'),
  }),
  'create-followup-subtask': z.object({
    parentKey: issueKey,
    summary: z.string().trim().min(3).max(250),
    description: z.string().trim().max(5000).default(''),
  }),
  'flag-issue': z.object({ issueKey, reason: z.string().trim().max(2000).default('') }),
  'publish-risk-report': z.object({
    projectKey,
    spaceKey: z.string().trim().min(1).max(255),
    sprintId: z.number().int().positive().optional(),
    parentPageId: z
      .string()
      .trim()
      .regex(/^\d+$/)
      .optional(),
  }),
} as const;

export type OpName = keyof typeof opSchemas;
export const OP_NAMES = Object.keys(opSchemas) as OpName[];

export interface OpDeps extends Deps {
  confluence: Requester;
  accountId: string;
  newToken: () => string;
  siteUrl?: string;
}

export type OpResult =
  | { status: 'confirmation_required'; operation: OpName; preview: string; confirmationToken: string; expiresInMinutes: number; arguments: Record<string, unknown>; instructions: string }
  | { status: 'done'; operation: OpName; message: string; details?: Record<string, unknown> }
  | { status: 'rejected'; operation: OpName | string; message: string };

function issueUrl(siteUrl: string | undefined, key: string): string | undefined {
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}/browse/${key}` : undefined;
}

async function preview(op: OpName, args: Record<string, unknown>, deps: OpDeps): Promise<string> {
  const map = await cachedFieldMap(deps.jira, deps.now().getTime());
  switch (op) {
    case 'add-risk-comment': {
      const a = args as z.infer<(typeof opSchemas)['add-risk-comment']>;
      const i = await getIssueBasics(deps.jira, a.issueKey);
      return `Add this comment to ${i.key} "${i.summary}":\n\n${a.comment}`;
    }
    case 'add-risk-label': {
      const a = args as z.infer<(typeof opSchemas)['add-risk-label']>;
      const i = await getIssueBasics(deps.jira, a.issueKey);
      if (i.labels.includes(a.label)) return `${i.key} already has the label "${a.label}" — confirming will change nothing.`;
      return `Add the label "${a.label}" to ${i.key} "${i.summary}" (current labels: ${i.labels.join(', ') || 'none'}).`;
    }
    case 'create-followup-subtask': {
      const a = args as z.infer<(typeof opSchemas)['create-followup-subtask']>;
      const i = await getIssueBasics(deps.jira, a.parentKey);
      return `Create a sub-task under ${i.key} "${i.summary}":\nSummary: ${a.summary}${a.description ? `\nDescription: ${a.description}` : ''}\nLabel: sentinel-followup`;
    }
    case 'flag-issue': {
      const a = args as z.infer<(typeof opSchemas)['flag-issue']>;
      const i = await getIssueBasics(deps.jira, a.issueKey, map);
      if (!map.flagged) return `This site has no "Flagged" field, so ${i.key} cannot be flagged.`;
      return `${i.flagged ? `${i.key} is already flagged; confirming keeps the flag` : `Flag ${i.key} "${i.summary}" as an impediment`}${a.reason ? ` and add the comment: "${a.reason}"` : ''}.`;
    }
    case 'publish-risk-report': {
      const a = args as z.infer<(typeof opSchemas)['publish-risk-report']>;
      const space = await getSpaceByKey(deps.confluence, a.spaceKey);
      if (!space) throw new Error(`Confluence space "${a.spaceKey}" was not found or you cannot see it.`);
      const out = await runAnalysis(deps, a.projectKey, a.sprintId, { record: false });
      if (!out.result) throw new Error(out.message ?? 'No sprint to report on.');
      return `Publish a new Confluence page "${reportTitle(out.result)}" in space ${space.name} (${space.key}) with sprint risk ${out.result.riskScore ?? 'n/a'}/100, ${out.result.findings.length} findings, the top-risk table and the trend vs. the last run.`;
    }
  }
}

async function execute(op: OpName, args: Record<string, unknown>, deps: OpDeps): Promise<{ message: string; details?: Record<string, unknown> }> {
  switch (op) {
    case 'add-risk-comment': {
      const a = args as z.infer<(typeof opSchemas)['add-risk-comment']>;
      const c = await addComment(deps.jira, a.issueKey, a.comment);
      return { message: `Comment added to ${a.issueKey}.`, details: { commentId: c.id, url: issueUrl(deps.siteUrl, a.issueKey) } };
    }
    case 'add-risk-label': {
      const a = args as z.infer<(typeof opSchemas)['add-risk-label']>;
      await addLabel(deps.jira, a.issueKey, a.label);
      return { message: `Label "${a.label}" added to ${a.issueKey}.`, details: { url: issueUrl(deps.siteUrl, a.issueKey) } };
    }
    case 'create-followup-subtask': {
      const a = args as z.infer<(typeof opSchemas)['create-followup-subtask']>;
      const s = await createSubtask(deps.jira, a.parentKey, a.summary, a.description);
      return { message: `Created sub-task ${s.key} under ${a.parentKey}.`, details: { key: s.key, url: issueUrl(deps.siteUrl, s.key) } };
    }
    case 'flag-issue': {
      const a = args as z.infer<(typeof opSchemas)['flag-issue']>;
      const map = await cachedFieldMap(deps.jira, deps.now().getTime());
      await setFlag(deps.jira, a.issueKey, map, true);
      if (a.reason) await addComment(deps.jira, a.issueKey, `Flagged as an impediment: ${a.reason}`);
      return { message: `${a.issueKey} is now flagged as an impediment.`, details: { url: issueUrl(deps.siteUrl, a.issueKey) } };
    }
    case 'publish-risk-report': {
      const a = args as z.infer<(typeof opSchemas)['publish-risk-report']>;
      const space = await getSpaceByKey(deps.confluence, a.spaceKey);
      if (!space) throw new Error(`Confluence space "${a.spaceKey}" was not found.`);
      const out = await runAnalysis(deps, a.projectKey, a.sprintId);
      if (!out.result || !out.trend) throw new Error(out.message ?? 'No sprint to report on.');
      const page = await createPage(deps.confluence, space.id, reportTitle(out.result), buildReportStorage(out.result, out.trend, deps.siteUrl), a.parentPageId);
      await saveSettings(deps.kv, a.projectKey, { reportSpaceKey: space.key });
      await deps.kv.set(`last-report:${a.projectKey}`, { pageId: page.id, title: page.title, url: page.webui, at: deps.now().toISOString() });
      return {
        message: `Published "${page.title}" to ${space.name}.`,
        details: { pageId: page.id, url: page.webui, riskScore: out.result.riskScore, trend: out.trend.direction, riskDelta: out.trend.riskDelta },
      };
    }
  }
}

function formatZodError(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

/**
 * Run a write operation through the two-phase confirmation protocol.
 * Without `confirmationToken`: validate, build a preview, store a pending op and return the token.
 * With `confirmationToken`: verify it (single use) and execute.
 */
export async function runOperation(op: string, rawArgs: Record<string, unknown>, deps: OpDeps): Promise<OpResult> {
  if (!(OP_NAMES as string[]).includes(op)) return { status: 'rejected', operation: op, message: `Unknown operation "${op}".` };
  const name = op as OpName;
  const { confirmationToken, ...rest } = rawArgs;
  const parsed = opSchemas[name].safeParse(rest);
  if (!parsed.success) return { status: 'rejected', operation: name, message: `Invalid input — ${formatZodError(parsed.error)}` };
  const args = parsed.data as Record<string, unknown>;
  if (!deps.accountId) return { status: 'rejected', operation: name, message: 'Write actions need a signed-in user.' };

  try {
    if (typeof confirmationToken !== 'string' || !confirmationToken.trim()) {
      const text = await preview(name, args, deps);
      const token = deps.newToken();
      const pending = createPending(name, args, deps.accountId, text, deps.now().getTime());
      await putPending(deps.kv, token, pending);
      return {
        status: 'confirmation_required',
        operation: name,
        preview: text,
        confirmationToken: token,
        expiresInMinutes: 15,
        arguments: args,
        instructions:
          'NOTHING HAS BEEN WRITTEN. Show this preview to the user and ask them to confirm. Only if the user explicitly confirms, call the same action again with exactly the same arguments plus this confirmationToken.',
      };
    }
    const pending = await takePending(deps.kv, confirmationToken.trim());
    const check = verifyPending(pending, name, args, deps.accountId, deps.now().getTime());
    if (!check.ok) return { status: 'rejected', operation: name, message: check.reason };
    const done = await execute(name, args, deps);
    return { status: 'done', operation: name, ...done };
  } catch (e) {
    return { status: 'rejected', operation: name, message: (e as Error).message.slice(0, 500) };
  }
}
