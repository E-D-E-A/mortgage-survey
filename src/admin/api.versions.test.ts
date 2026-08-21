// The versions client, tested where it can actually break: the URL.
//
// A version name is not a tame identifier. Production carries
// `2026-08-09.1-main-משכתנאות-2` — the optional publish label, in Hebrew — and
// `2026-08-07.1`, from before versions carried a slug at all. Both have to
// survive the trip to the function and back, or reading an old version fails
// for exactly the surveys old enough to have interesting history.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVersion, listVersions } from './api';

const HEBREW_LABEL = '2026-08-09.1-main-משכתנאות-2';
const NO_SLUG = '2026-08-07.1';

let requested: string[];

// The api layer reaches for a token before every call; the token itself is not
// what these tests are about.
vi.mock('./supabaseClient', () => ({ accessToken: async () => 'test-token' }));

beforeEach(() => {
  requested = [];
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(url);
    const body = url.includes('version=')
      ? { version: HEBREW_LABEL, published_at: '2026-08-09T05:03:02Z', config: { screens: [] } }
      : { versions: [{ version: HEBREW_LABEL, published_at: '2026-08-09T05:03:02Z' }] };
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('listVersions', () => {
  it('asks the admin endpoint, not the public one', async () => {
    await listVersions('main');
    expect(requested[0]).toBe('/.netlify/functions/admin-versions?survey=main');
  });

  it('unwraps the versions array', async () => {
    const versions = await listVersions('main');
    expect(versions).toEqual([{ version: HEBREW_LABEL, published_at: '2026-08-09T05:03:02Z' }]);
  });
});

describe('getVersion', () => {
  it('percent-encodes a version name carrying Hebrew', async () => {
    await getVersion('main', HEBREW_LABEL);
    const url = requested[0];
    expect(url).toContain(`version=${encodeURIComponent(HEBREW_LABEL)}`);
    // The raw Hebrew must not reach the query string unencoded.
    expect(url).not.toContain('משכתנאות');
    // …and it has to decode back to exactly what we asked for.
    expect(decodeURIComponent(new URL(url, 'https://x.test').searchParams.get('version')!)).toBe(
      HEBREW_LABEL,
    );
  });

  it('handles a version from before version names carried a slug', async () => {
    await getVersion('main', NO_SLUG);
    const url = new URL(requested[0], 'https://x.test');
    // The survey is scoped separately, so a name with no slug in it still
    // resolves — the endpoint never infers the survey from the version.
    expect(url.searchParams.get('survey')).toBe('main');
    expect(url.searchParams.get('version')).toBe(NO_SLUG);
  });
});
