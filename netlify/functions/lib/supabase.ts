// Server-side PostgREST helpers, shared by every function.
// The service_role key lives only here (Netlify environment variables) and never
// in the browser.

export interface SupabaseEnv {
  url: string;
  key: string;
}

/** Reads the secrets; a Response with 503 if the environment is not configured. */
export function supabaseEnv(): SupabaseEnv | Response {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response('server not configured', { status: 503 });
  return { url, key };
}

export function supaHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// PostgREST's two "not in the schema cache" codes: the SQL function, or the
// table, is not in the project this key points at. They are the one upstream
// failure that is not an outage — the database is BEHIND THE CODE, no retry can
// ever succeed, and the only fix is applying supabase/schema.sql to the project.
//
// Reporting them as a bare 502 is what made the missing mcp_rate_hit read like a
// dead server: the debugging went through a paused project and a broken deploy
// before the Supabase logs finally named the function. A 404 with one of these
// codes says exactly which object is missing, so the answer travels in the
// response instead of only in logs the caller may have no access to.
const MISSING_FUNCTION = 'PGRST202';
const MISSING_TABLE = 'PGRST205';

export type UpstreamObjectKind = 'function' | 'table';

export interface MissingObject {
  kind: UpstreamObjectKind;
  name: string;
}

export interface UpstreamProblem {
  status: number;
  code: string | null;
  message: string | null;
  /** The object is absent from the database, as opposed to unreachable */
  schemaDrift: boolean;
}

/**
 * Reads a failed PostgREST response. Deliberately total: a proxy in front of the
 * database answers with HTML, and a diagnostic helper that throws while
 * diagnosing is worse than the failure it was called about.
 */
export async function readUpstreamProblem(res: Response): Promise<UpstreamProblem> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    parsed = null;
  }
  const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  const code = typeof body.code === 'string' ? body.code : null;
  return {
    status: res.status,
    code,
    message: typeof body.message === 'string' ? body.message : null,
    schemaDrift: res.status === 404 && (code === MISSING_FUNCTION || code === MISSING_TABLE),
  };
}

const objectLabel = (o: MissingObject): string =>
  `${o.kind === 'function' ? 'הפונקציה' : 'הטבלה'} ${o.name}`;

/**
 * The finished 500 for a database that is missing objects the code needs.
 * Exported so a caller that can enumerate ALL of its missing objects (see
 * lib/mcp.ts) reports them in one answer, rather than handing back the first one
 * and letting the next call discover the next.
 */
export function schemaDriftResponse(missing: MissingObject[]): Response {
  return json(
    {
      error: 'schema-drift',
      missing,
      message:
        `בסיס הנתונים של הפרויקט הזה חסר את ${missing.map(objectLabel).join(', ')}. ` +
        'זו אינה תקלת שרת זמנית ואין טעם לנסות שוב: הסכימה בקוד לא הוחלה על הפרויקט. ' +
        'התיקון — להריץ את supabase/schema.sql מול הפרויקט (SQL Editor בדשבורד Supabase, ' +
        'או npm run db:schema מול סטאק מקומי). הקובץ אידמפוטנטי ובטוח להרצה חוזרת.',
    },
    500,
  );
}

/**
 * The finished error Response for a failed PostgREST call, naming what the call
 * was reaching for. Schema drift gets its own status and body (above);
 * everything else stays the 502 it always was — a real upstream failure — now
 * carrying the upstream status and PostgREST code so the same guessing does not
 * have to happen a second time.
 */
export async function upstreamFailure(
  res: Response,
  kind: UpstreamObjectKind,
  name: string,
): Promise<Response> {
  const problem = await readUpstreamProblem(res);
  if (problem.schemaDrift) return schemaDriftResponse([{ kind, name }]);
  return json(
    {
      error: 'upstream',
      target: { kind, name },
      upstream_status: problem.status,
      code: problem.code,
      message: `הקריאה ל-${objectLabel({ kind, name })} נכשלה מול בסיס הנתונים (${problem.status})${problem.message ? `: ${problem.message}` : ''}`,
    },
    502,
  );
}

/**
 * Calling a SQL function through PostgREST (rpc). The parameters travel as a JSON
 * body — no SQL is ever built from strings. A Response means an upstream failure;
 * otherwise the JSON that came back.
 * ⚠ The function names are kept in sync with schema.sql — enforced by
 * tests/sync/stats-sql.test.ts, which recognises calls of the form
 * rpc(<env>, '<name>', ...).
 */
export async function rpc(
  env: SupabaseEnv,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown | Response> {
  const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: supaHeaders(env.key),
    body: JSON.stringify(args),
  });
  if (!res.ok) return upstreamFailure(res, 'function', fn);
  return res.json();
}
