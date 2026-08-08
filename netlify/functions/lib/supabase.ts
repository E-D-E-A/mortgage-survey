// עזרי צד-שרת ל-PostgREST, משותפים לכל הפונקציות.
// ה-service_role key חי רק כאן (משתני סביבה של Netlify) ולעולם לא בדפדפן.

export interface SupabaseEnv {
  url: string;
  key: string;
}

/** קורא את הסודות; Response עם 503 אם הסביבה לא מוגדרת. */
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
