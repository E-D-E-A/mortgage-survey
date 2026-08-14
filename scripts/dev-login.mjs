// Signing in to the console against the local stack — Google has no provider in
// the local environment, so we create a local user and inject the session into
// the browser by hand.
// Usage: npm run dev:login  (requires `npx supabase start`; netlify dev runs
// separately)
// Local only: the keys here are supabase start's public demo keys — identical in
// every local installation and worthless against the cloud.

const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'dev-admin@first-edea.com';
const PASSWORD = 'local-dev-password-1';

// A user with providers=['google'] — as requireAdmin on the server demands
const created = await fetch(`${API}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { provider: 'google', providers: ['google'] },
  }),
});
if (!created.ok && created.status !== 422) {
  console.error('user creation failed — האם `npx supabase start` רץ?', created.status, await created.text());
  process.exit(1);
}

const tokenRes = await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!tokenRes.ok) {
  console.error('sign-in failed:', tokenRes.status, await tokenRes.text());
  process.exit(1);
}
const session = await tokenRes.json();

// supabase-js's key for the local address: sb-<ref>-auth-token, ref='127'
const snippet = `localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(session))}); location.reload();`;

console.log(`
נכנסים לקונסולה מול הסטאק המקומי בשלושה צעדים:

1. ‎.env‎ מצביע על הסטאק המקומי (הערכים של \`npx supabase status\`) ו-\`netlify dev\` רץ
2. פותחים  http://127.0.0.1:8888/admin  (מסך הכניסה יופיע)
3. מדביקים בקונסולת הדפדפן (F12 → Console) את השורה הבאה:

${snippet}

הטוקן תקף לשעה; פג — מריצים שוב. המשתמש: ${EMAIL} (מקומי בלבד).
`);
