// בדיקות אינטגרציה מול ה-Supabase המקומי (ENG-12). לא רצות בסתם `npm test`:
// הן דורשות סטאק רץ (`npx supabase start`) ודגל מפורש —
//   bash:        DB_TESTS=1 npx vitest run tests/db
//   PowerShell:  $env:DB_TESTS='1'; npx vitest run tests/db
// בלי הדגל הקבוצה מדולגת (ירוקה) — CI נשאר בלי Docker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, connectLocal, dbTestsEnabled, type Sql } from './harness';

// session_id קבוע לפיקסטורה — הבדיקה מוחקת ומכניסה מחדש את האירועים שלה,
// ולכן ריצה חוזרת על סטאק חי לא צוברת כפילויות.
const SID = '11111111-1111-4111-8111-111111111111';
const VERSION = '2026-08-01.1-ittest';

const uid = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;

describe.runIf(dbTestsEnabled)('local Supabase stack', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    // פעמיים בכוונה: schema.sql מוצהר כ-idempotent — הרצה שנייה חייבת לעבור נקי
    await applySchema(sql);
    await applySchema(sql);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('round-trips a completed session through the completed_responses view', async () => {
    await sql`insert into surveys (slug, name, created_by) values ('ittest', 'שאלון בדיקה', 'test')
              on conflict (slug) do nothing`;
    await sql`insert into survey_configs (version, survey_id, config, published_by)
              values (${VERSION}, 'ittest', ${sql.json({ version: VERSION, screens: [] })}, 'test')
              on conflict (version) do nothing`;
    await sql`delete from survey_events where session_id = ${SID}`;

    await sql`insert into survey_events (event_uid, session_id, survey_version, event_type, screen_id, payload)
              values
      (${uid(1)}, ${SID}, ${VERSION}, 'session_start', null, ${sql.json({ vars: { url_source: 'it' } })}),
      (${uid(2)}, ${SID}, ${VERSION}, 'screen_view', 'q1', ${sql.json({ index: 0, attempt: 1 })}),
      (${uid(3)}, ${SID}, ${VERSION}, 'answer', 'q1', ${sql.json({ value: 'yes', ms: 1200, attempt: 1 })}),
      (${uid(4)}, ${SID}, ${VERSION}, 'complete', 'end', ${sql.json({ variant: 'complete', answers: { q1: 'yes' }, vars: {} })})`;

    const rows = await sql`select outcome, survey_id from completed_responses where session_id = ${SID}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('complete');
    expect(rows[0].survey_id).toBe('ittest');
  });

  it('demo seed populates a browsable amount of sessions', async () => {
    const { seedDemo } = await import('../../scripts/seed-stats.mjs');
    await seedDemo(sql);
    const [{ n }] = await sql`
      select count(distinct session_id)::int as n
      from survey_events where survey_version like '%-demo'`;
    expect(n).toBeGreaterThan(50);
  });
});
