// The HTTP client's auth contract: a 401 must drop the cached session (via
// the onUnauthorized hook) so the next call genuinely re-opens the browser
// login — the tool's error text promises exactly that, and an unwired hook
// would leave a revoked-but-unexpired token replaying until it aged out.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpApiClient } from '../../tools/mcp-server/src/api';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('HttpApiClient auth handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a 401 triggers onUnauthorized so the next token() starts a fresh login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })));
    const onUnauthorized = vi.fn(async () => {});
    const client = new HttpApiClient('http://api.test', async () => 'dead-token', onUnauthorized);

    const res = await client.listSurveys();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('success and non-401 failures leave the session alone', async () => {
    const onUnauthorized = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { surveys: [] })));
    const client = new HttpApiClient('http://api.test', async () => 'tok', onUnauthorized);
    expect((await client.listSurveys()).ok).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: 'forbidden' })));
    expect((await client.listSurveys()).ok).toBe(false);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('sends the Bearer token only to the configured API base', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        seen.push(String(url));
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        return jsonResponse(200, { surveys: [] });
      }),
    );
    const client = new HttpApiClient('http://api.test', async () => 'tok');
    await client.listSurveys();
    await client.getDraft('demo', true);
    await client.getAudit('demo', 5);
    expect(seen.every((u) => u.startsWith('http://api.test/.netlify/functions/'))).toBe(true);
  });
});
