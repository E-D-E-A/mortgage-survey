// ייצוא CSV (admin-export): הקצה רץ מלא מול הסטאק המקומי — auth אמיתי,
// PostgREST אמיתי (כולל ציטוט in.(...) של שמות גרסאות עם נקודות ומקפים),
// והיפוך לשורה-לכל-סשן. רץ רק עם DB_TESTS=1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySchema,
  connectLocal,
  createAdminUser,
  dbTestsEnabled,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  signIn,
  type Sql,
} from './harness';
import { ensureSurvey, idFactory, resetEvents, sessionEvents } from './fixtures';

const V1 = '2026-08-01.1-extest';
const V2 = '2026-08-02.1-extest';
const ids = idFactory('e5');

// בלי פסיקים בנוסחים ובתשובות — כדי ששורת ה-CSV בבדיקה תיפרס ב-split פשוט
const configV2 = {
  version: V2,
  varMeta: { segment: { label: 'פרסונה', values: { A: 'קבוצה א' } } },
  screens: [
    {
      type: 'single',
      id: 'q_status',
      prompt: 'מה מצבכם?',
      options: [
        { id: 'own', label: 'בעלות' },
        { id: 'rent', label: 'שכירות' },
      ],
    },
    {
      type: 'matrix',
      id: 'q_worry',
      prompt: 'כמה מדאיג?',
      items: [{ id: 'rate', label: 'הריבית' }],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'כלל לא',
      maxLabel: 'מאוד',
    },
    { type: 'text', id: 'q_open', prompt: 'ספרו לנו', optional: true },
    { type: 'end', id: 'done', variant: 'complete', title: 'תודה', body: '' },
  ],
};
const configV1 = {
  version: V1,
  screens: [
    ...configV2.screens.filter((s) => s.id !== 'q_worry'),
    {
      type: 'single',
      id: 'q_retired',
      prompt: 'שאלה ישנה',
      options: [{ id: 'x', label: 'איקס' }],
    },
  ],
};

// s1: הושלם ב-V2 עם תשובה מכל סוג · s2: סשן בדיקה (מוחרג כברירת מחדל)
// s3: נכנס ולא ענה כלל · s4: הושלם ב-V1 עם השאלה שפרשה
const fixture = [
  ...sessionEvents(ids, 1, V2, {
    steps: [
      { screen: 'q_status', answer: 'rent', vars: { segment: 'A' } },
      { screen: 'q_worry', answer: { rate: 5 } },
      { screen: 'q_open', answer: 'טקסט חופשי' },
    ],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 2, V2, {
    startVars: { url_test: '1' },
    steps: [{ screen: 'q_status', answer: 'own', vars: { segment: 'A', url_test: '1' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A', url_test: '1' } },
  }),
  ...sessionEvents(ids, 3, V2, { steps: [{ screen: 'q_status' }] }),
  ...sessionEvents(ids, 4, V1, {
    steps: [{ screen: 'q_retired', answer: 'x', vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
];

/**
 * פירוק CSV נאיבי — הפיקסטורה נבנתה בלי פסיקים וציטוטים בתאים.
 * ה-BOM נבדק על הבייטים הגולמיים: Response.text() מסיר אותו לפי מפרט Fetch,
 * אבל ההורדה בדפדפן עוברת דרך blob() ששומר בייטים כלשונם.
 */
const parse = async (res: Response) => {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes.slice(3));
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  return lines.map((l) => l.split(','));
};

describe.runIf(dbTestsEnabled)('admin-export endpoint', () => {
  let sql: Sql;
  let token: string;

  const call = async (query: string, auth?: string) => {
    const { default: handler } = await import('../../netlify/functions/admin-export.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(new Request(`http://localhost/.netlify/functions/admin-export?${query}`, { headers }));
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'extest', 'שאלון ייצוא', [
      { version: V1, config: configV1 },
      { version: V2, config: configV2 },
    ]);
    await resetEvents(sql, [V1, V2], fixture);
    await createAdminUser('stats-admin@first-edea.com');
    token = await signIn('stats-admin@first-edea.com');
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('דורש auth ומחזיר CSV להורדה: שורה לכל סשן אמיתי, בלי סשני בדיקה', async () => {
    expect((await call('survey=extest')).status).toBe(401);

    const res = await call('survey=extest', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/extest-all-.*\.csv/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const rows = await parse(res);
    const [idsRow, labels] = rows;
    // הקונפיג החדש קובע סדר; השאלה שפרשה מ-V1 מצטרפת אחריו
    expect(idsRow).toEqual([
      'session_id', 'survey_version', 'started_at', 'outcome', 'is_test',
      'segment', 'q_status', 'q_worry.rate', 'q_open', 'q_retired',
    ]);
    expect(labels[idsRow.indexOf('segment')]).toBe('פרסונה');

    // שתי כותרות + s1, s3, s4 — סשן הבדיקה s2 איננו
    expect(rows).toHaveLength(5);
    const cell = (row: string[], id: string) => row[idsRow.indexOf(id)];
    const byOutcome = Object.fromEntries(rows.slice(2).map((r) => [cell(r, 'outcome'), r]));

    // שני סשנים הושלמו (V1 ו-V2) — בוחרים את של V2 לפי הגרסה, לא לפי התוצאה
    const done = rows
      .slice(2)
      .find((r) => cell(r, 'survey_version') === V2 && cell(r, 'outcome') === 'complete') as string[];
    expect(cell(done, 'q_status')).toBe('שכירות'); // קוד rent → תווית
    expect(cell(done, 'q_worry.rate')).toBe('5');
    expect(cell(done, 'q_open')).toBe('טקסט חופשי');
    expect(cell(done, 'segment')).toBe('A');
    expect(cell(byOutcome['abandoned_bounce'], 'q_status')).toBe('');
    const v1row = rows.slice(2).find((r) => cell(r, 'survey_version') === V1);
    expect(cell(v1row as string[], 'q_retired')).toBe('איקס');
  });

  it('סינון גרסה מצמצם שורות ועמודות; include_test מחזיר את סשן הבדיקה', async () => {
    const v2only = await parse(await call(`survey=extest&version=${V2}`, token));
    expect(v2only[0]).not.toContain('q_retired');
    expect(v2only).toHaveLength(4); // כותרות + s1 + s3

    const withTest = await parse(await call('survey=extest&include_test=1', token));
    expect(withTest).toHaveLength(6);
    const isTest = withTest[0].indexOf('is_test');
    expect(withTest.slice(2).filter((r) => r[isTest] === '1')).toHaveLength(1);
  });

  it('מאמת פרמטרים: גרסה זרה, שאלון חסר ושאלון לא קיים', async () => {
    expect((await call('survey=extest&version=no-such', token)).status).toBe(400);
    expect((await call('survey=', token)).status).toBe(400);
    expect((await call('survey=no-such', token)).status).toBe(404);
  });
});
