// Shared plumbing for the MCP endpoints (mcp-draft, mcp-surveys, mcp-audit):
// per-user rate limiting, idempotency-key replay, and the audit log.
//
// All of it is server-side on purpose. The MCP server that calls these
// endpoints runs on a teammate's machine and anyone can run a modified copy —
// so nothing here trusts it. The budgets protect the app from an agent loop,
// the idempotency keys make network retries safe, and the audit log records
// what actually happened regardless of what the client claims.

import {
  json,
  readUpstreamProblem,
  rpc,
  schemaDriftResponse,
  supaHeaders,
  upstreamFailure,
  type MissingObject,
  type SupabaseEnv,
} from './supabase';

const HOUR_SECONDS = 3600;

/**
 * The tables this whole layer stands on, all created by the same block of
 * supabase/schema.sql as mcp_rate_hit. They are listed here so that ONE failed
 * call can report the whole picture: the rate limiter is the first gate on every
 * MCP endpoint, so a database that never had the block applied fails here first,
 * and answering "mcp_rate_hit is missing" alone would send the reader to fix one
 * object and hit the next wall on the next call.
 */
const MCP_TABLES = ['mcp_rate_limits', 'mcp_idempotency_keys', 'mcp_audit_log'] as const;

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

/** Whether a failure Response is the structured "the database is behind the code" one. */
async function isSchemaDrift(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null;
    return body?.error === 'schema-drift';
  } catch {
    return false;
  }
}

/**
 * Which of the MCP tables the database is missing, alongside mcp_rate_hit which
 * the caller has already established is absent. A probe per table, in parallel,
 * on a path that is already failing — it costs nothing in the normal case,
 * because it only ever runs once the rate limiter has hit drift.
 */
async function reportSchemaDrift(env: SupabaseEnv): Promise<Response> {
  const probes = await Promise.all(
    MCP_TABLES.map(async (name): Promise<MissingObject | null> => {
      const res = await fetch(`${env.url}/rest/v1/${name}?select=*&limit=0`, {
        headers: supaHeaders(env.key),
      });
      if (res.ok) return null;
      return (await readUpstreamProblem(res)).schemaDrift ? { kind: 'table', name } : null;
    }),
  );
  return schemaDriftResponse([
    { kind: 'function', name: 'mcp_rate_hit' },
    ...probes.filter((p): p is MissingObject => p !== null),
  ]);
}

/**
 * Counts this request against the user's hourly budget. Returns null when the
 * request is within budget, or the finished 429 Response when it is not. A
 * failure to reach the counter is never a silent pass: an endpoint that fails
 * open under DB trouble is an endpoint with no rate limit at all.
 *
 * The failure is reported for what it is. A database missing the MCP block is a
 * deployment fault in this system — a 500 naming every missing object and the
 * file that creates them — not the 502 that reads as "the database is down" and
 * sends the reader looking for an outage that is not there.
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
  if (result instanceof Response) {
    return (await isSchemaDrift(result)) ? reportSchemaDrift(env) : result;
  }
  const rows = result as { allowed: boolean; retry_after_seconds: number }[];
  const row = rows[0];
  if (!row) {
    // The function exists and answered with nothing, which its definition in
    // schema.sql cannot do. Saying that beats "upstream error": the thing to
    // look at is the function body in the database, not the network.
    return json(
      {
        error: 'upstream',
        target: { kind: 'function', name: 'mcp_rate_hit' },
        message:
          'הפונקציה mcp_rate_hit החזירה תשובה ריקה — ייתכן שהיא מוגדרת בבסיס הנתונים בגרסה שאינה תואמת ל-supabase/schema.sql',
      },
      502,
    );
  }
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
  if (!res.ok) return upstreamFailure(res, 'table', 'mcp_idempotency_keys');
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
 *
 * Best-effort, like recordAudit — but it says so now. Returning the note instead
 * of swallowing it is what keeps "the retry you were promised was safe quietly
 * stopped being safe" from being visible only in the database logs.
 */
export async function storeIdempotentResult(
  env: SupabaseEnv,
  email: string,
  key: string,
  survey: string,
  status: number,
  response: unknown,
): Promise<string | null> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
  await fetch(
    `${env.url}/rest/v1/mcp_idempotency_keys?created_at=lt.${encodeURIComponent(cutoff)}`,
    { method: 'DELETE', headers: supaHeaders(env.key) },
  );
  const res = await fetch(
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
  if (res.ok) return null;
  return describeBestEffortFailure(
    res,
    'mcp_idempotency_keys',
    'מפתח האידמפוטנטיות לא נשמר, ולכן שליחה חוזרת של אותו שינוי עלולה להיכתב פעמיים',
  );
}

/**
 * One audit row per executed MCP write. Best-effort by design: the write has
 * already happened, and failing the request afterwards would tell the client
 * the draft was not saved when it was.
 *
 * "Best-effort" used to mean "silent", which put the only evidence in the
 * database logs. It now returns a note the endpoint attaches to its answer, so
 * a draft that saved without being logged says so on the spot.
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
): Promise<string | null> {
  const res = await fetch(`${env.url}/rest/v1/mcp_audit_log`, {
    method: 'POST',
    headers: { ...supaHeaders(env.key), Prefer: 'return=minimal' },
    body: JSON.stringify(entry),
  });
  if (res.ok) return null;
  return describeBestEffortFailure(res, 'mcp_audit_log', 'השינוי בוצע אך לא נרשם ביומן השינויים');
}

/** The note for a best-effort write that failed, naming the object and the fix. */
async function describeBestEffortFailure(
  res: Response,
  table: string,
  consequence: string,
): Promise<string> {
  const problem = await readUpstreamProblem(res);
  if (problem.schemaDrift) {
    return (
      `${consequence}: הטבלה ${table} אינה קיימת בבסיס הנתונים — ` +
      'יש להריץ את supabase/schema.sql מול הפרויקט.'
    );
  }
  const detail = problem.message ? ` — ${problem.message}` : '';
  return `${consequence}: הכתיבה ל-${table} נכשלה (${problem.status})${detail}.`;
}
