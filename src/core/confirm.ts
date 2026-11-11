import { createHash } from 'node:crypto';

/**
 * Two-phase confirmation for every write action.
 *
 * Phase 1: the action is called without a confirmation token. Nothing is written; the caller gets a
 * preview plus a single-use token bound to (operation, arguments, user).
 * Phase 2: the action is called again with that token after the human explicitly confirmed. The token
 * is verified, consumed, and only then is the write performed.
 *
 * This is enforced server side, so neither the LLM nor an MCP client can skip the human step.
 */

export const CONFIRMATION_TTL_MS = 15 * 60_000;

export interface PendingOperation {
  op: string;
  argsHash: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
  preview: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex');
}

export function createPending(op: string, args: Record<string, unknown>, accountId: string, preview: string, now: number): PendingOperation {
  return { op, argsHash: hashArgs(args), accountId, createdAt: now, expiresAt: now + CONFIRMATION_TTL_MS, preview };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyPending(
  pending: PendingOperation | undefined,
  op: string,
  args: Record<string, unknown>,
  accountId: string,
  now: number,
): VerifyResult {
  if (!pending) return { ok: false, reason: 'Unknown or already-used confirmation token. Ask for a new preview.' };
  if (pending.expiresAt < now) return { ok: false, reason: 'Confirmation token expired. Ask for a new preview.' };
  if (pending.op !== op) return { ok: false, reason: `Token was issued for "${pending.op}", not "${op}".` };
  if (pending.accountId !== accountId) return { ok: false, reason: 'Token was issued to a different user.' };
  if (pending.argsHash !== hashArgs(args)) return { ok: false, reason: 'Arguments changed after the preview. Ask for a new preview.' };
  return { ok: true };
}
