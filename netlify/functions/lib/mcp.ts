// Shared plumbing for the MCP endpoints (mcp-draft, mcp-surveys, mcp-audit):
// per-user rate limiting, idempotency-key replay, and the audit log.
//
// All of it is server-side on purpose. The MCP server that calls these
// endpoints runs on a teammate's machine and anyone can run a modified copy —
// so nothing here trusts it. The budgets protect the app from an agent loop,
// the idempotency keys make network retries safe, and the audit log records
// what actually happened regardless of what the client claims.

import { json, rpc, supaHeaders, type SupabaseEnv } from './supabase';

const HOUR_SECONDS = 3600;

/** Budgets are env-tunable so the DB tests can exercise the 429 path cheaply. */
function limitFor(bucket: 'read' | 'write'): number {
  const raw =
    bucket === 'write'
      ? process.env.MCP_WRITE_LIMIT_PER_HOUR
      : process.env.MCP_READ_LIMIT_PER_HOUR;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return bucket === 'write' ? 30 : 300;
}

/**
 * Counts this request against the user's hourly budget. Returns null when the
 * request is within budget, or the finished 429 Response when it is not. A
 * failure to reach the counter is a 502 — never a silent pass: an endpoint
 * that fails open under DB trouble is an endpoint with no rate limit at all.
 */
export async function enforceRateLimit(
  env: SupabaseEnv,
  email: string,
  bucket: 'read' | 'write',
): Promise<Response | null> {
  const result = await rpc(env, 'mcp_rate_hit', {
    p_email: email,
    p_bucket: bucket,
    p_limit: limitFor(bucket),
    p_window_seconds: HOUR_SECONDS,
  });
  if (result instanceof Response) return result;
  const rows = result as { allowed: boolean; retry_after_seconds: number }[];
  const row = rows[0];
  if (!row) return new Response('upstream error', { status: 502 });
  if (row.allowed) return null;
  return json(
    {
      error: 'rate-limit',
      retry_after_seconds: row.retry_after_seconds,
      message: `חריגה ממכסת הבקשות — יש להמתין ${row.retry_after_seconds} שניות ולא לנסות שוב לפני כן`,
    },
    429,
    { 'Retry-After': String(row.retry_after_seconds) },
  );
}

const IDEMPOTENCY_TTL_HOURS = 24;

export interface StoredIdempotentResult {
  status: number;
  response: unknown;
}

/**
 * The stored result for a key this user has already executed on this survey,
 * or null. Scoped by survey as well as user — the same key sent for a
 * different survey must execute, not silently replay another survey's result.
 * Expired rows are excluded here and swept in storeIdempotentResult (i.e. on
 * executed writes only, which the write budget bounds) — a lookup must stay a
 * single cheap read, because the caller meters it against the read budget.
 */
export async function findIdempotentReplay(
  env: SupabaseEnv,
  email: string,
  key: string,
  survey: string,
): Promise<StoredIdempotentResult | Response | null> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
  const res = await fetch(
    `${env.url}/rest/v1/mcp_idempotency_keys?user_email=eq.${encodeURIComponent(email)}` +
      `&idem_key=eq.${encodeURIComponent(key)}&survey_id=eq.${encodeURIComponent(survey)}` +
      `&created_at=gte.${encodeURIComponent(cutoff)}&select=status,response`,
    { headers: supaHeaders(env.key) },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const rows = (await res.json()) as StoredIdempotentResult[];
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Records an executed write under its idempotency key. A concurrent duplicate
 * (two requests racing the same key) is tolerated: the loser's insert conflicts
 * and is ignored, and the optimistic lock on the draft itself already ensured
 * only one of them actually wrote.
 *
 * The TTL sweep lives here, on the write path: executed writes are bounded by
 * the write budget, so the sweep cannot be driven in a loop — putting it on
 * the replay path handed an unmetered caller a table scan per request.
 */
export async function storeIdempotentResult(
  env: SupabaseEnv,
  email: string,
  key: string,
  survey: string,
  status: number,
  response: unknown,
): Promise<void> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
  await fetch(
    `${env.url}/rest/v1/mcp_idempotency_keys?created_at=lt.${encodeURIComponent(cutoff)}`,
    { method: 'DELETE', headers: supaHeaders(env.key) },
  );
  await fetch(
    `${env.url}/rest/v1/mcp_idempotency_keys?on_conflict=user_email,idem_key`,
    {
      method: 'POST',
      headers: {
        ...supaHeaders(env.key),
        Prefer: 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        user_email: email,
        idem_key: key,
        survey_id: survey,
        status,
        response,
      }),
    },
  );
}

/**
 * One audit row per executed MCP write. Best-effort by design: the write has
 * already happened, and failing the request afterwards would tell the client
 * the draft was not saved when it was.
 */
export async function recordAudit(
  env: SupabaseEnv,
  entry: {
    user_email: string;
    survey_id: string;
    revision_before: string | null;
    revision_after: string;
    summary: string;
  },
): Promise<void> {
  await fetch(`${env.url}/rest/v1/mcp_audit_log`, {
    method: 'POST',
    headers: { ...supaHeaders(env.key), Prefer: 'return=minimal' },
    body: JSON.stringify(entry),
  });
}
