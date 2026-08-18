// Admin authentication against Supabase Auth. The client sends Authorization:
// Bearer <access_token>, which it got from supabase-js after signing in with
// Google; here we verify it against Supabase and enforce the domain.
//
// This is the only enforcement point. Important: the anon key is public, so
// anyone on the internet can complete a Google sign-in against the project — the
// restriction to first-edea.com is enforced here and not in the browser. The hd
// parameter on the button, Google's Internal consent screen and the
// before-user-created hook are additional layers, not a substitute for this check.

const ALLOWED_DOMAIN = 'first-edea.com';

interface SupabaseUser {
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
}

export interface AdminSession {
  email: string;
}

/**
 * Verifies the Bearer token and returns the editor's identity, or a Response
 * carrying the error: 401 — token missing/malformed/expired. 403 — a valid user,
 * but not from the permitted domain.
 */
export async function requireAdmin(req: Request): Promise<AdminSession | Response> {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return new Response('server not configured', { status: 503 });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 8192) return new Response('unauthorized', { status: 401 });

  const res = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: supaKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return new Response('unauthorized', { status: 401 });

  const user = (await res.json()) as SupabaseUser;
  const email = (user.email ?? '').toLowerCase();

  // Verified email only — blocks an account registered with a domain address without confirming it
  if (!(user.email_confirmed_at ?? user.confirmed_at)) {
    return new Response('forbidden: email not confirmed', { status: 403 });
  }
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return new Response(`forbidden: ${ALLOWED_DOMAIN} accounts only`, { status: 403 });
  }

  // Defence in depth: a Google identity only. Deliberately checks providers (the
  // array) and not provider (the single value) — on an account first created
  // with a password and later linked to Google, provider stays 'email' while
  // providers holds both. If the field is missing we do not block: the real
  // enforcement is the domain check above plus turning the Email provider off in
  // the dashboard.
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.length > 0 && !providers.includes('google')) {
    return new Response('forbidden: google sign-in required', { status: 403 });
  }

  return { email };
}
