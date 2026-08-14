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
  if (!res.ok) return new Response('upstream error', { status: 502 });
  return res.json();
}
