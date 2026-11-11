import type { PendingOperation } from '../core/confirm';
import type { Settings, Snapshot, SprintRiskResult } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { appendSnapshot } from '../core/trend';

/** Minimal key-value interface so storage logic is testable without Forge. */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ProjectSettings extends Settings {
  reportSpaceKey?: string;
  reportParentPageId?: string;
}

const k = {
  settings: (p: string) => `settings:${p}`,
  snapshots: (p: string, s: number) => `snapshots:${p}:${s}`,
  pending: (t: string) => `pending:${t}`,
  watched: () => 'watched-projects',
  cache: (p: string, s: number) => `cache:${p}:${s}`,
  seed: (p: string) => `seed:${p}`,
  lastReport: (p: string) => `last-report:${p}`,
};

export const keys = k;

export async function getSettings(kv: KV, projectKey: string): Promise<ProjectSettings> {
  return { ...DEFAULT_SETTINGS, ...((await kv.get<Partial<ProjectSettings>>(k.settings(projectKey))) ?? {}) };
}

export async function saveSettings(kv: KV, projectKey: string, settings: Partial<ProjectSettings>): Promise<ProjectSettings> {
  const merged = { ...(await getSettings(kv, projectKey)), ...settings };
  await kv.set(k.settings(projectKey), merged);
  return merged;
}

export async function getSnapshots(kv: KV, projectKey: string, sprintId: number): Promise<Snapshot[]> {
  return (await kv.get<Snapshot[]>(k.snapshots(projectKey, sprintId))) ?? [];
}

export async function recordSnapshot(kv: KV, projectKey: string, snap: Snapshot): Promise<Snapshot[]> {
  const next = appendSnapshot(await getSnapshots(kv, projectKey, snap.sprintId), snap);
  await kv.set(k.snapshots(projectKey, snap.sprintId), next);
  return next;
}

export async function watchProject(kv: KV, projectKey: string): Promise<void> {
  const list = (await kv.get<string[]>(k.watched())) ?? [];
  if (!list.includes(projectKey)) await kv.set(k.watched(), [...list, projectKey].slice(-50));
}

export async function watchedProjects(kv: KV): Promise<string[]> {
  return (await kv.get<string[]>(k.watched())) ?? [];
}

export async function putPending(kv: KV, token: string, op: PendingOperation): Promise<void> {
  await kv.set(k.pending(token), op);
}

/** Read and delete in one step: tokens are single-use. */
export async function takePending(kv: KV, token: string): Promise<PendingOperation | undefined> {
  const p = await kv.get<PendingOperation>(k.pending(token));
  if (p) await kv.delete(k.pending(token));
  return p;
}

const CACHE_MAX_BYTES = 200_000;

export interface CachedResult {
  at: number;
  result: SprintRiskResult;
}

export async function cacheResult(kv: KV, result: SprintRiskResult, now: number): Promise<void> {
  const value: CachedResult = { at: now, result };
  if (JSON.stringify(value).length > CACHE_MAX_BYTES) return;
  await kv.set(k.cache(result.project.key, result.sprint.id), value);
}

export async function getCachedResult(kv: KV, projectKey: string, sprintId: number, now: number, maxAgeMs: number): Promise<SprintRiskResult | null> {
  const c = await kv.get<CachedResult>(k.cache(projectKey, sprintId));
  return c && now - c.at <= maxAgeMs ? c.result : null;
}

/** In-memory KV for tests and the local CLI. */
export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, structuredClone(value));
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
}
