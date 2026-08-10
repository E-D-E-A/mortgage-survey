// הטיוטה היא מה שהעורך רואה ומה שהפרסום ייקח. שתי סכנות: קונפיג שנשמר
// *שונה* ממה שנשלח (ואז התרשים בקונסולה מספר סיפור אחר מהמסכים שיוגשו),
// ושמירה שדורסת עבודה של עורך אחר. שתיהן נבדקות כאן.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../admin-draft.mts';
import type { SurveyConfig } from '../../../src/engine/types';
import { ADMIN_EMAIL, adminRequest, expectAuthGate, installHarness, type Harness } from './harness';

const config: SurveyConfig = {
  version: 'draft',
  randomVars: { price: [39, 59] },
  varMeta: { segment: { label: 'מסלול', values: { A: 'ראשון' } } },
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה', body: 'שורה\n\nשורה שנייה' },
    {
      id: 'q1',
      type: 'multi',
      prompt: 'מה מפריע? {price}',
      maxSelections: 2,
      options: [
        { id: 'a', label: 'אלף' },
        { id: 'none', label: 'כלום', exclusive: true },
      ],
      showIf: { all: [{ q: 'intro', op: 'answered' }, { not: { var: 'segment', op: 'eq', value: 'A' } }] },
    },
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

const get = (query = '') => handler(adminRequest(`admin-draft${query}`));
const put = (query: string, body: unknown) =>
  handler(adminRequest(`admin-draft${query}`, { method: 'PUT', body: JSON.stringify(body) }));

describe('reading a draft', () => {
  it('returns the stored config and its timestamp, scoped to the survey', async () => {
    h.on({
      match: /\/rest\/v1\/survey_drafts\?/,
      body: [{ config, updated_at: '2026-08-09T10:00:00Z' }],
    });
    const res = await get('?survey=pilot-2');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config, updated_at: '2026-08-09T10:00:00Z' });
    expect(h.to('survey_drafts')[0].url).toContain('survey_id=eq.pilot-2');
  });

  it('says "no draft" rather than failing, so the console can offer to create one', async () => {
    h.on({ match: /\/rest\/v1\/survey_drafts\?/, body: [] });
    expect(await (await get('?survey=fresh')).json()).toEqual({ config: null, updated_at: null });
  });

  it('answers 502 when the database fails, instead of "no draft"', async () => {
    h.on({ match: /\/rest\/v1\/survey_drafts\?/, status: 500, text: 'boom' });
    expect((await get('?survey=main')).status).toBe(502);
  });
});

describe('saving a draft stores exactly what the editor sent', () => {
  beforeEach(() => {
    h.on({ match: /\/rest\/v1\/survey_drafts\?/, method: 'PATCH', body: [{ updated_at: 'x' }] });
  });

  it('writes the config unchanged — every screen, condition and label', async () => {
    const res = await put('?survey=main', { config, expected_updated_at: '2026-08-09T10:00:00Z' });
    expect(res.status).toBe(200);
    const written = h.to('survey_drafts')[0].body as { config: SurveyConfig; updated_by: string };
    expect(written.config).toEqual(config);
    expect(written.updated_by).toBe(ADMIN_EMAIL);
  });

  it('updates only the row of that survey, and only if nobody else did', async () => {
    await put('?survey=pilot-2', { config, expected_updated_at: '2026-08-09T10:00:00Z' });
    const url = h.to('survey_drafts')[0].url;
    expect(url).toContain('survey_id=eq.pilot-2');
    expect(url).toContain('updated_at=eq.2026-08-09T10%3A00%3A00Z');
  });

  it('refuses with 409 when the draft changed underneath (no row matched)', async () => {
    h.on({ match: /\/rest\/v1\/survey_drafts\?/, method: 'PATCH', body: [] });
    const res = await put('?survey=main', { config, expected_updated_at: 'stale' });
    expect(res.status).toBe(409);
  });

  it('creates the first draft with an insert when there is no timestamp yet', async () => {
    h.on({ match: /\/rest\/v1\/survey_drafts$/, method: 'POST', status: 201 });
    const res = await put('?survey=fresh', { config, expected_updated_at: null });
    expect(res.status).toBe(200);
    const call = h.to('survey_drafts')[0];
    expect(call.method).toBe('POST');
    expect((call.body as { survey_id: string }).survey_id).toBe('fresh');
    expect((call.body as { config: SurveyConfig }).config).toEqual(config);
  });

  it('distinguishes "survey does not exist" (404) from "someone was first" (409)', async () => {
    h.on({
      match: /\/rest\/v1\/survey_drafts$/,
      method: 'POST',
      status: 409,
      text: 'violates foreign key constraint "survey_drafts_survey_id_fkey"',
    });
    expect((await put('?survey=ghost', { config, expected_updated_at: null })).status).toBe(404);

    h.on({ match: /\/rest\/v1\/survey_drafts$/, method: 'POST', status: 409, text: 'duplicate key' });
    expect((await put('?survey=main', { config, expected_updated_at: null })).status).toBe(409);
  });
});

describe('a draft may be invalid, but it must be a questionnaire', () => {
  it.each([
    ['no config at all', { expected_updated_at: null }],
    ['config without screens', { config: { version: 'x' }, expected_updated_at: null }],
    ['screens that are not an array', { config: { screens: 'many' }, expected_updated_at: null }],
    ['a non-string timestamp', { config, expected_updated_at: 42 }],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await put('?survey=main', body);
    expect(res.status).toBe(400);
    expect(h.to('survey_drafts')).toHaveLength(0);
  });

  it('accepts a draft that fails validation — only publishing is gated', async () => {
    h.on({ match: /\/rest\/v1\/survey_drafts\?/, method: 'PATCH', body: [{ updated_at: 'x' }] });
    const broken: SurveyConfig = { version: 'wip', screens: [{ id: 'q', type: 'single', prompt: '', options: [] }] };
    expect((await put('?survey=main', { config: broken, expected_updated_at: 'now' })).status).toBe(200);
  });

  it('rejects a config over 500KB with 413', async () => {
    const huge = { config: { screens: [{ id: 'x', body: 'y'.repeat(500_001) }] }, expected_updated_at: null };
    expect((await put('?survey=main', huge)).status).toBe(413);
    expect(h.to('survey_drafts')).toHaveLength(0);
  });

  it('rejects invalid json with 400', async () => {
    const res = await handler(
      adminRequest('admin-draft?survey=main', { method: 'PUT', body: '{oops' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('only a first-edea editor can read or write a draft', () => {
  it('blocks an unauthenticated or outside caller before touching the database', async () => {
    await expectAuthGate(handler, 'admin-draft');
    await expectAuthGate(handler, 'admin-draft', {
      method: 'PUT',
      body: JSON.stringify({ config, expected_updated_at: null }),
    });
  });

  it('refuses methods other than GET and PUT', async () => {
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const res = await handler(adminRequest('admin-draft?survey=main', { method }));
      expect(res.status).toBe(405);
    }
  });

  it('refuses an invalid slug before querying anything', async () => {
    expect((await get('?survey=Bad')).status).toBe(400);
    expect(h.to('survey_drafts')).toHaveLength(0);
  });
});
