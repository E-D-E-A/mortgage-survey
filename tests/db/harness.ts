// The DB tests' harness: a local-only connection, and applying the schema to the
// `supabase start` stack. The guard here is deliberately hard — the tests refuse
// any non-local host, so that a run with a .env pointing at the cloud can never
// touch real data.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

/** The suite runs only when asked for explicitly: DB_TESTS=1 (with `npx supabase start` running) */
export const dbTestsEnabled = process.env.DB_TESTS === '1';

/** The local stack's default (the DB port from supabase/config.toml) */
export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function connectLocal(): Sql {
  const url = process.env.SUPABASE_DB_URL ?? LOCAL_DB_URL;
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`DB tests refuse a non-local database host: ${host}`);
  }
  return postgres(url, { onnotice: () => {} });
}

export async function applySchema(sql: Sql): Promise<void> {
  const ddl = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  // vitest runs test files in parallel against the same DB; an advisory lock
  // serialises the DDL (repeated drop/create) so two files never apply the schema
  // at the same time.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(732912)`;
    await tx.unsafe(ddl);
  });
}

// ─── local Auth: real users and tokens for requireAdmin ─────────────────────
// These keys are `supabase start`'s public demo keys — identical in every local
// installation, and not a secret. They are worthless against the cloud.
export const LOCAL_API_URL = 'http://127.0.0.1:54321';
export const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
export const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TEST_PASSWORD = 'local-test-password-1';

/**
 * Creates a user through the local admin API, email-confirmed and with
 * providers=['google'] — like a real console user (requireAdmin demands a Google
 * identity). Signing in from the tests uses a password; app_metadata stays as it
 * is set here.
 */
export async function createAdminUser(email: string): Promise<void> {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      app_metadata: { provider: 'google', providers: ['google'] },
    }),
  });
  // 422 = already exists from an earlier run — that is fine
  if (!res.ok && res.status !== 422) {
    throw new Error(`createAdminUser(${email}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function signIn(email: string): Promise<string> {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: LOCAL_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`signIn(${email}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}
