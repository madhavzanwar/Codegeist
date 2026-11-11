/**
 * Transport-agnostic HTTP helpers shared by the Forge adapters (requestJira / requestConfluence)
 * and the local seed CLI (fetch + API token). Handles JSON, retries on 429/5xx with Retry-After,
 * and pagination helpers.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export type Requester = (path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<HttpResponse>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} for ${path}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const defaultRetry: RetryPolicy = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function retryDelay(attempt: number, retryAfter: string | null, policy: RetryPolicy): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(policy.maxDelayMs, secs * 1000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(policy.maxDelayMs, Math.max(0, at - Date.now()));
  }
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
}

const RETRYABLE = new Set([429, 502, 503, 504]);

/** Perform a request with JSON encoding and retry on rate limiting / transient errors. */
export async function request(req: Requester, path: string, opts: RequestOptions = {}, policy: RetryPolicy = defaultRetry): Promise<HttpResponse> {
  const init = {
    method: opts.method ?? 'GET',
    headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const res = await req(path, init);
    if (!RETRYABLE.has(res.status) || attempt >= policy.maxRetries) return res;
    await policy.sleep(retryDelay(attempt, res.headers.get('Retry-After'), policy));
  }
}

export async function requestJson<T>(req: Requester, path: string, opts: RequestOptions = {}, policy?: RetryPolicy): Promise<T> {
  const res = await request(req, path, opts, policy);
  if (!res.ok) throw new HttpError(res.status, path, await res.text().catch(() => ''));
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Paginate an offset-based (startAt/maxResults/isLast or total) endpoint. */
export async function paginateOffset<T>(
  req: Requester,
  buildPath: (startAt: number) => string,
  pick: (page: Record<string, unknown>) => T[],
  maxItems = 1000,
  policy?: RetryPolicy,
): Promise<T[]> {
  const out: T[] = [];
  let startAt = 0;
  for (;;) {
    const page = await requestJson<Record<string, unknown>>(req, buildPath(startAt), {}, policy);
    const items = pick(page);
    out.push(...items);
    startAt += items.length;
    const total = typeof page.total === 'number' ? page.total : undefined;
    const isLast = page.isLast === true || items.length === 0 || (total !== undefined && startAt >= total);
    if (isLast || out.length >= maxItems) break;
  }
  return out.slice(0, maxItems);
}

/** Encode a single path segment safely (issue keys, project keys, ids). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/;
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{0,49}$/;
