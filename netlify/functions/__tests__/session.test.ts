// נקודת האכיפה היחידה על מי שיכול לערוך ולפרסם. ה-anon key ציבורי, ולכן כל
// אחד באינטרנט יכול להשלים כניסת Google מול הפרויקט — ההגבלה לדומיין נאכפת
// כאן, בשרת, בכל בקשה. כפתור, hd, ומסך הסכמה Internal הם שכבות נוספות.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../lib/session';
import { SERVICE_KEY, SUPA_URL, VALID_USER, installHarness, type Harness } from './harness';

let h: Harness;

beforeEach(() => {
  h = installHarness();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (authorization?: string) =>
  new Request('https://site.example/.netlify/functions/admin-draft', {
    headers: authorization ? { Authorization: authorization } : {},
  });

const asUser = (user: Record<string, unknown>) =>
  h.on({ match: /\/auth\/v1\/user/, body: user });

describe('a valid editor', () => {
  it('is identified by the email Supabase confirms, lowercased', async () => {
    asUser({ ...VALID_USER, email: 'Editor@First-Edea.com' });
    const session = await requireAdmin(request('Bearer good-token'));
    expect(session).toEqual({ email: 'editor@first-edea.com' });
  });

  it('is verified against Supabase with the caller token and the service key', async () => {
    await requireAdmin(request('Bearer good-token'));
    const call = h.calls[0];
    expect(call.url).toBe(`${SUPA_URL}/auth/v1/user`);
    expect(call.headers.Authorization).toBe('Bearer good-token');
    expect(call.headers.apikey).toBe(SERVICE_KEY);
  });

  it('passes when the provider list is absent (older account records)', async () => {
    asUser({ email: 'x@first-edea.com', email_confirmed_at: '2026-01-01T00:00:00Z' });
    expect(await requireAdmin(request('Bearer good-token'))).toEqual({ email: 'x@first-edea.com' });
  });

  it('passes when a password account was later linked to Google', async () => {
    asUser({
      ...VALID_USER,
      app_metadata: { provider: 'email', providers: ['email', 'google'] },
    });
    expect(await requireAdmin(request('Bearer good-token'))).toEqual({ email: VALID_USER.email });
  });
});

describe('401 — the caller is not authenticated', () => {
  it.each([
    ['no Authorization header', undefined],
    ['a header that is not Bearer', 'Basic dXNlcjpwYXNz'],
    ['an empty Bearer token', 'Bearer '],
    ['an absurdly long token', `Bearer ${'x'.repeat(9000)}`],
  ])('rejects %s without asking Supabase', async (_name, header) => {
    const res = (await requireAdmin(request(header))) as Response;
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a token Supabase refuses', async () => {
    h.on({ match: /\/auth\/v1\/user/, status: 401, text: 'invalid jwt' });
    expect(((await requireAdmin(request('Bearer stale'))) as Response).status).toBe(401);
  });
});

describe('403 — authenticated, but not allowed to edit', () => {
  it.each([
    ['a gmail account', { ...VALID_USER, email: 'someone@gmail.com' }],
    ['a lookalike domain', { ...VALID_USER, email: 'someone@first-edea.com.evil.com' }],
    ['a domain that only ends similarly', { ...VALID_USER, email: 'someone@notfirst-edea.com' }],
    ['no email at all', { ...VALID_USER, email: undefined }],
  ])('rejects %s', async (_name, user) => {
    asUser(user);
    const res = (await requireAdmin(request('Bearer good-token'))) as Response;
    expect(res.status).toBe(403);
  });

  it('rejects an unconfirmed email even inside the domain', async () => {
    asUser({ ...VALID_USER, email_confirmed_at: null, confirmed_at: null });
    const res = (await requireAdmin(request('Bearer good-token'))) as Response;
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('email not confirmed');
  });

  it('accepts the legacy confirmed_at field', async () => {
    asUser({ ...VALID_USER, email_confirmed_at: undefined, confirmed_at: '2026-01-01T00:00:00Z' });
    expect(await requireAdmin(request('Bearer good-token'))).toEqual({ email: VALID_USER.email });
  });

  it('rejects an identity that is not Google', async () => {
    asUser({ ...VALID_USER, app_metadata: { provider: 'email', providers: ['email'] } });
    const res = (await requireAdmin(request('Bearer good-token'))) as Response;
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('google');
  });
});

describe('503 — the server has no credentials', () => {
  it('never falls back to allowing the request', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const res = (await requireAdmin(request('Bearer good-token'))) as Response;
    expect(res.status).toBe(503);
    expect(h.calls).toHaveLength(0);
  });
});
