// איזה שאלון מוגש למשיב. זו החוליה שבה "פרסום השאלון הלא נכון" הופך מבאג
// תיאורטי לנתונים אבודים: קישור שמגיש גרסה ישנה, שאלון מאורכב שעוד מגיש,
// או סשן באמצע שקיבל פתאום גרסה אחרת.
//
// ⚠ אין כאן אימות בכוונה — הקונפיג ממילא מוצג לכל משיב. מה שנבדק כאן הוא
//   *הבחירה*: איזה slug, איזו גרסה, ומה קורה כשאין.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../config-get.mts';
import { SUPA_URL, installHarness, type Harness } from './harness';

const config = {
  version: 'v1.1',
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה', body: 'ג' },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

let h: Harness;

beforeEach(() => {
  h = installHarness();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const get = (query = '') =>
  handler(new Request(`https://site.example/.netlify/functions/config-get${query}`));

/** שאלון פעיל עם גרסה אחת שפורסמה. */
function published(slug = 'main', version = '2026-08-09.1-main') {
  h.on({ match: /\/rest\/v1\/surveys\?/, body: [{ archived_at: null }] });
  h.on({
    match: /\/rest\/v1\/survey_configs\?/,
    body: [{ survey_id: slug, version, config: { ...config, version } }],
  });
}

describe('a new session gets the active version of the survey it asked for', () => {
  it('serves the newest published version, and only that one', async () => {
    published('pilot-2', '2026-08-09.3-pilot-2');
    const res = await get('?survey=pilot-2');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { survey: string; version: string; config: unknown };
    expect(body.survey).toBe('pilot-2');
    expect(body.version).toBe('2026-08-09.3-pilot-2');
    expect(body.config).toEqual({ ...config, version: '2026-08-09.3-pilot-2' });

    // השאילתה היא מה שמבטיח "הנכון": השאלון הזה, הפרסום האחרון, שורה אחת
    const query = h.to('survey_configs')[0].url;
    expect(query).toContain('survey_id=eq.pilot-2');
    expect(query).toContain('order=published_at.desc');
    expect(query).toContain('limit=1');
  });

  it('serves the default survey when the link carries no slug', async () => {
    published();
    await get();
    expect(h.to('surveys')[0].url).toContain('slug=eq.main');
    expect(h.to('survey_configs')[0].url).toContain('survey_id=eq.main');
  });

  it('lets the browser cache the active version for a minute only', async () => {
    published();
    const res = await get('?survey=main');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
  });

  it('answers 404 for a survey that does not exist — never another survey', async () => {
    h.on({ match: /\/rest\/v1\/surveys\?/, body: [] });
    const res = await get('?survey=ghost');
    expect(res.status).toBe(404);
    expect(h.to('survey_configs')).toHaveLength(0);
  });

  it('answers 404 for a survey that exists but was never published', async () => {
    h.on({ match: /\/rest\/v1\/surveys\?/, body: [{ archived_at: null }] });
    h.on({ match: /\/rest\/v1\/survey_configs\?/, body: [] });
    expect((await get('?survey=fresh')).status).toBe(404);
  });

  it('answers 410 for an archived survey, so the respondent gets an explanation', async () => {
    h.on({ match: /\/rest\/v1\/surveys\?/, body: [{ archived_at: '2026-08-01T00:00:00Z' }] });
    const res = await get('?survey=old-screener');
    expect(res.status).toBe(410);
    expect(h.to('survey_configs')).toHaveLength(0);
  });
});

describe('a session that already started keeps its own version', () => {
  it('serves the pinned version verbatim, immutably cached', async () => {
    h.on({
      match: /\/rest\/v1\/survey_configs\?/,
      body: [{ survey_id: 'main', version: '2026-08-01.1-main', config }],
    });
    const res = await get('?version=2026-08-01.1-main');
    expect(res.status).toBe(200);
    expect(h.to('survey_configs')[0].url).toContain('version=eq.2026-08-01.1-main');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('does not check the survey list — an archived survey must still let people finish', async () => {
    h.on({
      match: /\/rest\/v1\/survey_configs\?/,
      body: [{ survey_id: 'old', version: 'v0.9', config }],
    });
    expect((await get('?version=v0.9')).status).toBe(200);
    expect(h.to('surveys')).toHaveLength(0);
  });

  it('answers 404 when the pinned version is gone, so the client can start over', async () => {
    h.on({ match: /\/rest\/v1\/survey_configs\?/, body: [] });
    expect((await get('?version=missing')).status).toBe(404);
  });
});

describe('bad input is refused before it becomes a query', () => {
  it.each([
    ['a slug with a PostgREST operator', '?survey=eq.main'],
    ['an uppercase slug', '?survey=Main'],
    ['a slug with a slash', '?survey=a/b'],
    ['an empty version', '?version='],
    ['a version over 100 chars', `?version=${'v'.repeat(101)}`],
  ])('rejects %s with 400', async (_name, query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(h.calls.filter((c) => c.url.includes('/rest/v1/'))).toHaveLength(0);
  });

  it('refuses anything but GET', async () => {
    const res = await handler(
      new Request('https://site.example/.netlify/functions/config-get', { method: 'POST' }),
    );
    expect(res.status).toBe(405);
  });

  it('answers 503 without credentials instead of serving a wrong default', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await get('?survey=main')).status).toBe(503);
  });

  it('answers 502 when the database itself fails', async () => {
    h.on({ match: /\/rest\/v1\/surveys\?/, status: 500, text: 'boom' });
    expect((await get('?survey=main')).status).toBe(502);
  });
});

describe('the secret never leaks to the respondent', () => {
  it('sends the service key upstream only, never in the response', async () => {
    published();
    const res = await get('?survey=main');
    const text = await res.text();
    expect(text).not.toContain('service-role-secret');
    expect([...res.headers.values()].join(' ')).not.toContain('service-role-secret');
    expect(h.to('survey_configs')[0].headers.apikey).toBe('service-role-secret');
    expect(h.to('survey_configs')[0].url.startsWith(SUPA_URL)).toBe(true);
  });
});
