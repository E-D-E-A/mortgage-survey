// The Supabase Auth client for the admin console (loaded only in the /admin
// chunk). The key here is the anon key — public by definition. It grants no
// access to data whatsoever: RLS blocks anon completely (zero policies), and it
// is used purely to talk to Supabase Auth. The enforcement (the first-edea.com
// domain) is server-side only.

import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const authConfigured = Boolean(URL_ && KEY);

// The return address from Google — it has to point at /admin, otherwise the
// redirect lands on the survey itself, where the console is never loaded. It has
// to appear in the Redirect URLs list in the Supabase dashboard, otherwise
// supabase ignores it and redirects to the Site URL instead.
export const adminRedirectUrl =
  typeof window === 'undefined' ? '' : `${window.location.origin}/admin`;

// detectSessionInUrl: supabase-js picks the tokens out of the URL on the return
// from Google by itself and broadcasts SIGNED_IN — there is no need to parse the
// address by hand.
export const supabase = createClient(URL_ ?? 'http://invalid.local', KEY ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const ALLOWED_DOMAIN = 'first-edea.com';

/** Redirects to Google. hd pre-filters the account chooser — a UX hint, not enforcement. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: adminRedirectUrl,
      queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

/** The current session's access token, to be sent to the functions as a Bearer. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
