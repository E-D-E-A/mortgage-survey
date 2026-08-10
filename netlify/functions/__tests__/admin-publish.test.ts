// פרסום גרסה. שתי הטענות שכל השאר נשען עליהן:
//   1. מה שמתפרסם הוא **הטיוטה השמורה של השאלון הזה**, כמות שהיא, עם version
//      חדש — ולא קונפיג אחר, לא של שאלון אחר, ולא גרסה חלקית.
//   2. שאלון שבור לא מתפרסם. הוולידציה כאן היא שער, לא הצעה — גם אם העורך
//      בדפדפן פספס אותה.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../admin-publish.mts';
import type { SurveyConfig } from '../../../src/engine/types';
import {
  ADMIN_EMAIL,
  VALID_USER,
  adminRequest,
  expectAuthGate,
  installHarness,
  type Harness,
} from './harness';

/** טיוטה תקינה: מסך פתיחה, שאלה עם ניתוב, ושני מסכי סיום. */
const draft: SurveyConfig = {
  version: 'draft-in-progress',
  varMeta: { segment: { label: 'מסלול', values: { A: 'ראשון' } } },
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה', body: 'גוף' },
    {
      id: 'q1',
      type: 'single',
      prompt: 'שאלה?',
      options: [
        { id: 'yes', label: 'כן' },
        { id: 'no', label: 'לא' },
      ],
      next: [{ if: { q: 'q1', op: 'eq', value: 'no' }, goto: 'end_screenout' }],
      onSubmit: [{ var: 'segment', value: 'A' }],
    },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה', body: '' },
    { id: 'end_screenout', type: 'end', variant: 'screenout', title: 'לא מתאים', body: '' },
  ],
};

const today = new Date().toISOString().slice(0, 10);

let h: Harness;

function setup(options: { draftConfig?: SurveyConfig | null; existing?: string[] } = {}) {
  const { draftConfig = draft, existing = [] } = options;
  h = installHarness();
  h.on({
    match: /\/rest\/v1\/survey_drafts\?/,
    body: draftConfig ? [{ config: draftConfig }] : [],
  });
  h.on({
    match: /\/rest\/v1\/survey_configs\?/,
    method: 'GET',
    body: existing.map((version) => ({ version })),
  });
  h.on({ match: /\/rest\/v1\/survey_configs$/, method: 'POST', status: 201 });
  return h;
}

const publish = (query = '', body: unknown = {}) =>
  handler(adminRequest(`admin-publish${query}`, { method: 'POST', body: JSON.stringify(body) }));

/** מה שנכתב לטבלת הגרסאות (או undefined אם לא נכתב דבר). */
function written(): { version: string; survey_id: string; config: SurveyConfig; published_by: string } | undefined {
  const call = h.to('survey_configs').find((c) => c.method === 'POST');
  return call?.body as never;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('what gets published is the saved draft, unchanged', () => {
  beforeEach(() => setup());

  it('stores the draft byte-for-byte, with only the version replaced', async () => {
    const res = await publish('?survey=main');
    expect(res.status).toBe(200);

    const row = written()!;
    expect(row.config).toEqual({ ...draft, version: row.version });
    // אין שדה שנעלם ואין שדה שנוסף — השוואת מפתחות מפורשת, כי deep-equal
    // עם version שונה יכול להסתיר השמטה
    expect(Object.keys(row.config).sort()).toEqual(Object.keys(draft).sort());
    expect(row.config.screens).toEqual(draft.screens);
    expect(row.config.varMeta).toEqual(draft.varMeta);
  });

  it('reads the draft of the survey it was asked to publish, and no other', async () => {
    await publish('?survey=pilot-2');
    expect(h.to('survey_drafts')[0].url).toContain('survey_id=eq.pilot-2');
    expect(written()!.survey_id).toBe('pilot-2');
  });

  it('publishes the default survey when no slug is given', async () => {
    await publish();
    expect(h.to('survey_drafts')[0].url).toContain('survey_id=eq.main');
    expect(written()!.survey_id).toBe('main');
  });

  it('records who published it', async () => {
    await publish('?survey=main');
    expect(written()!.published_by).toBe(ADMIN_EMAIL);
  });

  it('answers 404 when there is no draft to publish', async () => {
    setup({ draftConfig: null });
    const res = await publish('?survey=main');
    expect(res.status).toBe(404);
    expect(written()).toBeUndefined();
  });
});

describe('the version number identifies the survey and cannot collide', () => {
  it('numbers the first version of the day 1, and carries the slug', async () => {
    setup();
    const res = await publish('?survey=pilot-2');
    const { version } = (await res.json()) as { version: string };
    expect(version).toBe(`${today}.1-pilot-2`);
    expect(written()!.version).toBe(version);
  });

  it('continues past the versions already published today for that survey', async () => {
    setup({ existing: [`${today}.1-main`, `${today}.2-main`] });
    const { version } = (await (await publish('?survey=main')).json()) as { version: string };
    expect(version).toBe(`${today}.3-main`);
  });

  it('only counts versions of the same survey', async () => {
    setup();
    await publish('?survey=main');
    const query = h.to('survey_configs').find((c) => c.method === 'GET')!.url;
    expect(query).toContain('survey_id=eq.main');
    expect(query).toContain(`version=like.${today}`);
  });

  it('appends a sanitized label, so a version can be recognised later', async () => {
    setup();
    const { version } = (await (
      await publish('?survey=main', { label: '  Pilot Round 2!! ' })
    ).json()) as { version: string };
    expect(version).toBe(`${today}.1-main-pilot-round-2`);
  });

  it('caps the version at 100 chars, the limit the events table accepts', async () => {
    setup();
    const { version } = (await (
      await publish('?survey=main', { label: 'x'.repeat(200) })
    ).json()) as { version: string };
    expect(version.length).toBeLessThanOrEqual(100);
  });

  it('retries with the next number when two editors publish at once', async () => {
    setup();
    h.on({ match: /\/rest\/v1\/survey_configs$/, method: 'POST', statuses: [409, 201] });
    const { version } = (await (await publish('?survey=main')).json()) as { version: string };
    expect(version).toBe(`${today}.2-main`);
  });

  it('gives up with 409 rather than looping forever', async () => {
    setup();
    h.on({ match: /\/rest\/v1\/survey_configs$/, method: 'POST', status: 409 });
    const res = await publish('?survey=main');
    expect(res.status).toBe(409);
    expect(h.to('survey_configs').filter((c) => c.method === 'POST')).toHaveLength(3);
  });
});

describe('a broken survey cannot be published, whatever the editor believes', () => {
  const cases: [string, SurveyConfig][] = [
    ['a goto pointing nowhere', {
      ...draft,
      screens: [
        draft.screens[0],
        { ...draft.screens[1], next: [{ goto: 'nope' }] } as never,
        draft.screens[2],
      ],
    }],
    ['no end screen at all', { ...draft, screens: [draft.screens[0], draft.screens[1]] }],
    ['an empty questionnaire', { ...draft, screens: [] }],
    ['two screens sharing an id', {
      ...draft,
      screens: [draft.screens[0], { ...draft.screens[0] }, draft.screens[2]],
    }],
    ['a condition on a question that does not exist', {
      ...draft,
      screens: [
        draft.screens[0],
        { ...draft.screens[1], showIf: { q: 'ghost', op: 'eq', value: 'x' } } as never,
        draft.screens[2],
      ],
    }],
    ['a condition on an option that was renamed away', {
      ...draft,
      screens: [
        draft.screens[0],
        { ...draft.screens[1], next: [{ if: { q: 'q1', op: 'eq', value: 'maybe' }, goto: 'end_screenout' }] } as never,
        draft.screens[2],
        draft.screens[3],
      ],
    }],
    ['a choice question with no choices', {
      ...draft,
      screens: [
        draft.screens[0],
        { id: 'q1', type: 'single', prompt: 'שאלה?', options: [] } as never,
        draft.screens[2],
      ],
    }],
    ['a first screen shown only on a condition', {
      ...draft,
      screens: [
        { ...draft.screens[0], showIf: { q: 'q1', op: 'answered' } } as never,
        draft.screens[1],
        draft.screens[2],
        draft.screens[3],
      ],
    }],
  ];

  it.each(cases)('refuses %s with 422 and writes nothing', async (_name, broken) => {
    setup({ draftConfig: broken });
    const res = await publish('?survey=main');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { message: string }[] };
    expect(body.errors.length).toBeGreaterThan(0);
    expect(written(), 'a rejected draft must never reach survey_configs').toBeUndefined();
  });

  it('publishes despite warnings, and hands them back for the record', async () => {
    // מסך שאי אפשר להגיע אליו הוא אזהרה, לא שגיאה
    const withWarning: SurveyConfig = {
      ...draft,
      screens: [
        ...draft.screens,
        { id: 'orphan', type: 'info', title: 'נטוש', body: '', showIf: { q: 'q1', op: 'eq', value: 'yes' } } as never,
      ],
    };
    setup({ draftConfig: withWarning });
    const res = await publish('?survey=main');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: { code: string }[] };
    expect(body.warnings.map((w) => w.code)).toContain('unreachable');
    expect(written()!.config.screens).toHaveLength(5);
  });
});

describe('only a first-edea editor can publish', () => {
  it('blocks an unauthenticated or outside caller before touching the database', async () => {
    await expectAuthGate(handler, 'admin-publish', { method: 'POST', body: '{}' });
  });

  it('blocks an account whose email was never confirmed', async () => {
    setup();
    h.on({
      match: /\/auth\/v1\/user/,
      body: { ...VALID_USER, email_confirmed_at: null, confirmed_at: null },
    });
    expect((await publish('?survey=main')).status).toBe(403);
    expect(written()).toBeUndefined();
  });

  it('refuses anything but POST', async () => {
    setup();
    const res = await handler(adminRequest('admin-publish?survey=main', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('refuses an invalid slug before querying anything', async () => {
    setup();
    const res = await publish('?survey=eq.main');
    expect(res.status).toBe(400);
    expect(h.to('survey_drafts')).toHaveLength(0);
  });
});
