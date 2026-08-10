// שער הכתיבה היחיד ל-DB. service_role עוקף RLS, ולכן *כל* ההגנה על הנתונים
// נמצאת בפונקציה הזאת: whitelist שדות, enum סוגים, מגבלות גודל, ומסלול dedup.
// בדיקה כאן היא בדיקה של הדבר עצמו — הפונקציה מורצת כמו שהיא, עם Request אמיתי.
//
// ⚠ הקבצים בתיקייה הזאת אינם פונקציות: Netlify מגלה נקודות קצה לפי קבצים
// *ישירות* תחת netlify/functions, ולכן תיקיית משנה (כמו lib/) אינה נפרסת.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../events.mts';

const URL_BASE = 'https://project.supabase.co';
const KEY = 'service-role-secret';

interface Upstream {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
  body: unknown;
}

let upstream: Upstream[] = [];
let upstreamStatus = 201;

beforeEach(() => {
  upstream = [];
  upstreamStatus = 201;
  vi.stubEnv('SUPABASE_URL', URL_BASE);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const typed = init as Upstream['init'];
    upstream.push({ url: String(url), init: typed, body: JSON.parse(String(typed.body)) });
    return { ok: upstreamStatus < 400, status: upstreamStatus } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const validRow = (over: Record<string, unknown> = {}) => ({
  event_uid: '11111111-1111-4111-8111-111111111111',
  session_id: '22222222-2222-4222-8222-222222222222',
  survey_version: '2026-08-09.1-main',
  event_type: 'answer',
  screen_id: 's_age',
  payload: { value: 35, ms: 1200, attempt: 1 },
  client_ts: '2026-08-09T10:00:00.000Z',
  ...over,
});

const post = (body: unknown) =>
  handler(
    new Request('https://site.example/.netlify/functions/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('the happy path', () => {
  it('accepts a batch and answers 204 without a body', async () => {
    const res = await post([validRow()]);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(upstream).toHaveLength(1);
    expect(upstream[0].body).toEqual([validRow()]);
  });

  it('writes through the dedup path with the service key, server-side only', async () => {
    await post([validRow()]);
    const { url, init } = upstream[0];
    expect(url).toBe(`${URL_BASE}/rest/v1/survey_events?on_conflict=event_uid`);
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe(KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers.Prefer).toContain('resolution=ignore-duplicates');
  });

  it('keeps the batch order — the analysis reads client_ts and created_at together', async () => {
    const rows = [1, 2, 3].map((n) =>
      validRow({ event_uid: `1111111${n}-1111-4111-8111-111111111111` }),
    );
    await post(rows);
    expect((upstream[0].body as { event_uid: string }[]).map((r) => r.event_uid)).toEqual(
      rows.map((r) => r.event_uid),
    );
  });

  it('treats a duplicate (409) as success, so the client stops retrying', async () => {
    upstreamStatus = 409;
    expect((await post([validRow()])).status).toBe(204);
  });

  it('reports an upstream failure as 502, so the client keeps the rows queued', async () => {
    upstreamStatus = 500;
    expect((await post([validRow()])).status).toBe(502);
  });
});

describe('the whitelist', () => {
  it('drops any field the table does not have, instead of forwarding it', async () => {
    await post([validRow({ created_at: '1999-01-01', id: 7, evil: 'DROP TABLE' })]);
    const [row] = upstream[0].body as Record<string, unknown>[];
    expect(Object.keys(row).sort()).toEqual([
      'client_ts',
      'event_type',
      'event_uid',
      'payload',
      'screen_id',
      'session_id',
      'survey_version',
    ]);
  });

  it('keeps the payload itself untouched — it is the research data', async () => {
    const payload = { value: ['a', 'b'], ms: 10, nested: { deep: [1, { x: null }] } };
    await post([validRow({ payload })]);
    expect((upstream[0].body as Record<string, unknown>[])[0].payload).toEqual(payload);
  });
});

describe('rejections — nothing reaches the database', () => {
  const cases: [string, unknown][] = [
    ['not an array', { event_uid: 'x' }],
    ['empty batch', []],
    ['21 rows (cap is 20)', Array.from({ length: 21 }, () => validRow())],
    ['event_uid not a uuid', [validRow({ event_uid: 'not-a-uuid' })]],
    ['event_uid missing', [validRow({ event_uid: undefined })]],
    ['session_id not a uuid', [validRow({ session_id: '123' })]],
    ['unknown event_type', [validRow({ event_type: 'hack' })]],
    ['empty survey_version', [validRow({ survey_version: '' })]],
    ['survey_version over 100 chars', [validRow({ survey_version: 'v'.repeat(101) })]],
    ['screen_id over 200 chars', [validRow({ screen_id: 's'.repeat(201) })]],
    ['screen_id not a string', [validRow({ screen_id: 42 })]],
    ['payload is an array', [validRow({ payload: [1, 2] })]],
    ['payload is null', [validRow({ payload: null })]],
    ['payload over 50k chars', [validRow({ payload: { big: 'x'.repeat(50_001) } })]],
    ['client_ts unparseable', [validRow({ client_ts: 'yesterday' })]],
    ['one bad row among good ones', [validRow(), validRow({ event_type: 'nope' })]],
  ];

  it.each(cases)('rejects %s with 400', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(upstream, 'a rejected batch must not reach the database').toHaveLength(0);
  });

  it('rejects invalid json with 400', async () => {
    expect((await post('{not json')).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it('rejects a body over 200KB with 413 before parsing it', async () => {
    const res = await post(`[${'"x",'.repeat(50_000)}"x"]`);
    expect(res.status).toBe(413);
    expect(upstream).toHaveLength(0);
  });

  it('accepts a null screen_id (session_start has no screen)', async () => {
    expect((await post([validRow({ screen_id: null, event_type: 'session_start' })])).status).toBe(
      204,
    );
  });
});

describe('the endpoint refuses anything but a POST', () => {
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('%s → 405', async (method) => {
    const res = await handler(
      new Request('https://site.example/.netlify/functions/events', { method }),
    );
    expect(res.status).toBe(405);
    expect(upstream).toHaveLength(0);
  });
});

describe('a misconfigured server fails loudly', () => {
  it('answers 503 when the credentials are missing, and writes nothing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const res = await post([validRow()]);
    expect(res.status).toBe(503);
    expect(upstream).toHaveLength(0);
  });
});
