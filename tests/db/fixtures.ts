// עזרי פיקסטורות לבדיקות ה-DB. כל קובץ בדיקה מקבל prefix הקסדצימלי ייחודי
// (שני תווים) ו-slug משלו — vitest מריץ קבצים במקביל מול אותו DB, ובידוד
// המזהים הוא מה שמונע התנגשויות בין קבצים.
import type { Sql } from './harness';

const hex12 = (n: number) => n.toString(16).padStart(12, '0').slice(-12);

/** מזהי סשן/אירוע דטרמיניסטיים בתחום נפרד לכל קובץ בדיקה */
export function idFactory(filePrefix: string) {
  let events = 0;
  return {
    sid: (k: number) => `${filePrefix}5e5510-0000-4000-8000-${hex12(k)}`,
    uid: () => `${filePrefix}e0e070-0000-4000-8000-${hex12(++events)}`,
  };
}

export interface EventFixture {
  uid: string;
  sid: string;
  version: string;
  type: 'session_start' | 'screen_view' | 'answer' | 'complete' | 'screenout' | 'quotafull';
  screen?: string | null;
  payload?: Record<string, unknown>;
  /** offset בדקות מנקודת בסיס קבועה — סדר כרונולוגי בין אירועי הסשן */
  at?: number;
}

const BASE_TS = Date.UTC(2026, 7, 10, 8, 0, 0);

export async function ensureSurvey(
  sql: Sql,
  slug: string,
  name: string,
  versions: { version: string; config?: unknown }[],
): Promise<void> {
  await sql`insert into surveys (slug, name, created_by) values (${slug}, ${name}, 'test')
            on conflict (slug) do nothing`;
  for (const v of versions) {
    await sql`insert into survey_configs (version, survey_id, config, published_by)
              values (${v.version}, ${slug}, ${JSON.stringify(v.config ?? { version: v.version, screens: [] })}, 'test')
              on conflict (version) do nothing`;
  }
}

/** מוחק את אירועי הגרסאות הנתונות ומכניס את הפיקסטורה — ריצה חוזרת נקייה */
export async function resetEvents(sql: Sql, versions: string[], events: EventFixture[]): Promise<void> {
  await sql`delete from survey_events where survey_version in ${sql(versions)}`;
  if (events.length === 0) return;
  // ההכנסה עוברת כפרמטר jsonb יחיד ונפרשת בצד השרת — כך payload נשאר אובייקט
  // jsonb אמיתי (ולא מחרוזת-בתוך-jsonb, קידוד כפול ששובר כל payload -> 'vars')
  const rows = events.map((e, i) => ({
    event_uid: e.uid,
    session_id: e.sid,
    survey_version: e.version,
    event_type: e.type,
    screen_id: e.screen ?? null,
    payload: e.payload ?? {},
    ts: new Date(BASE_TS + (e.at ?? i) * 60_000).toISOString(),
  }));
  await sql`
    insert into survey_events
      (event_uid, session_id, survey_version, event_type, screen_id, payload, client_ts, created_at)
    select r.event_uid::uuid, r.session_id::uuid, r.survey_version, r.event_type,
           r.screen_id, r.payload, r.ts::timestamptz, r.ts::timestamptz
    from jsonb_to_recordset((${sql.json(rows as unknown as Parameters<Sql['json']>[0])})::jsonb)
      as r(event_uid text, session_id text, survey_version text, event_type text,
           screen_id text, payload jsonb, ts text)`;
}

/** אירועי סשן שלם בקיצור: התחלה → צפיות/תשובות → אירוע סיום אופציונלי */
export function sessionEvents(
  ids: ReturnType<typeof idFactory>,
  k: number,
  version: string,
  opts: {
    startVars?: Record<string, unknown>;
    steps?: { screen: string; answer?: unknown; ms?: number; attempt?: number; vars?: Record<string, unknown> }[];
    terminal?: 'complete' | 'screenout' | 'quotafull';
    terminalPayload?: Record<string, unknown>;
    atBase?: number;
  } = {},
): EventFixture[] {
  const sid = ids.sid(k);
  const at0 = opts.atBase ?? k * 100;
  let at = at0;
  const rows: EventFixture[] = [
    { uid: ids.uid(), sid, version, type: 'session_start', payload: { vars: opts.startVars ?? {} }, at: at++ },
  ];
  for (const step of opts.steps ?? []) {
    rows.push({ uid: ids.uid(), sid, version, type: 'screen_view', screen: step.screen, payload: { index: 0, attempt: step.attempt ?? 1 }, at: at++ });
    if (step.answer !== undefined) {
      const payload: Record<string, unknown> = { value: step.answer, ms: step.ms ?? 5000, attempt: step.attempt ?? 1 };
      if (step.vars) payload.vars = step.vars;
      rows.push({ uid: ids.uid(), sid, version, type: 'answer', screen: step.screen, payload, at: at++ });
    }
  }
  if (opts.terminal) {
    rows.push({
      uid: ids.uid(), sid, version, type: opts.terminal, screen: `end_${opts.terminal}`,
      payload: { variant: opts.terminal, answers: {}, vars: {}, ...opts.terminalPayload }, at: at++,
    });
  }
  return rows;
}
