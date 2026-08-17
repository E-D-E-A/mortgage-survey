// Fetching the quota state on entry to a survey.
//
// Every failure path here has to fail open. The cost of getting it wrong is
// invisible from the outside: the survey does not error, it simply starts turning
// real respondents away because of a fault of ours. That is the one thing this
// feature promises never to do, and until now none of it was tested.
//
// The suite runs in node, so `sessionStorage` does not exist and pinnedVersion()
// returns null through its own catch — which is exactly the "new session" case.
// The tests that need an already-started session stub it explicitly.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchQuotaCounts } from './quota';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A live survey: the endpoint exists only in production builds. */
function inProduction(): void {
  vi.stubEnv('PROD', true);
}

/** Replaces fetch with one that answers with this JSON body, and hands back the spy. */
function answering(body: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** A session already under way — the state key App writes, scoped to the default survey. */
function withSavedSession(raw: string): void {
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => (key.startsWith('sq_state_v1') ? raw : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

describe('fetchQuotaCounts · the happy path', () => {
  it('returns the counts the endpoint sent, unchanged', async () => {
    inProduction();
    answering({ counts: { persona: { young_couple: 12 } } });
    await expect(fetchQuotaCounts('main')).resolves.toEqual({ persona: { young_couple: 12 } });
  });

  it('asks the quota endpoint for the survey it was given', async () => {
    inProduction();
    const spy = answering({ counts: {} });
    await fetchQuotaCounts('mortgage-b');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe(
      '/.netlify/functions/quota-get?survey=mortgage-b',
    );
  });

  it('an empty counts map is a legitimate answer, not a failure', async () => {
    // Nobody has finished yet. Distinguishable from the failure branches only by
    // the body having been read at all.
    inProduction();
    const spy = answering({ counts: {} });
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a mark with no recorded values yet is passed through as it stands', async () => {
    inProduction();
    answering({ counts: { persona: {} } });
    await expect(fetchQuotaCounts('main')).resolves.toEqual({ persona: {} });
  });

  it('in development it never calls the endpoint — there are no functions to call', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fetchQuotaCounts · fails open on every fault', () => {
  it('a network error leaves the session with no quota full', async () => {
    inProduction();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
  });

  it('a server error is not even parsed — the body is never read', async () => {
    inProduction();
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json }) as unknown as Response));
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
    expect(json).not.toHaveBeenCalled();
  });

  it('a body that is not JSON at all fails open', async () => {
    inProduction();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })),
    );
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
  });

  it.each([
    ['no counts key at all', {}],
    ['counts is null', { counts: null }],
    ['counts is an array', { counts: [{ mark: 'persona' }] }],
    ['a mark holds a bare number instead of a map of values', { counts: { persona: 50 } }],
  ])('a malformed payload (%s) fails open', async (_name, body) => {
    inProduction();
    answering(body);
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
  });

  it('one non-numeric count discards the whole payload, valid marks included', async () => {
    // All or nothing on purpose: a payload we do not fully understand is not one
    // to close cells from, and half-trusting it would close some and not others.
    inProduction();
    answering({ counts: { persona: { young_couple: '50' }, city: { tel_aviv: 20 } } });
    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
  });
});

describe('fetchQuotaCounts · fetched once, at the start of a session', () => {
  it('a session already under way does not ask again — its flags are the ones it started with', async () => {
    // This is what keeps a respondent who began while a cell was open from being
    // thrown out mid-survey because it filled up in the meantime.
    inProduction();
    withSavedSession(JSON.stringify({ version: '2026-08-01.1-main' }));
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    await expect(fetchQuotaCounts('main')).resolves.toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('an unreadable saved session counts as no session, and the fetch goes ahead', async () => {
    inProduction();
    withSavedSession('{not json');
    const spy = answering({ counts: { persona: { young_couple: 3 } } });

    await expect(fetchQuotaCounts('main')).resolves.toEqual({ persona: { young_couple: 3 } });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a saved session with no version recorded counts as no session', async () => {
    inProduction();
    withSavedSession(JSON.stringify({ current: 'q1' }));
    const spy = answering({ counts: {} });

    await fetchQuotaCounts('main');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
