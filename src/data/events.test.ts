// רשימת סוגי האירועים חיה בשלוש שכבות: הלקוח, ה-Netlify Function והאילוץ
// ב-Postgres. סוג שקיים באחת וחסר באחרת נכשל בשקט המסוכן ביותר — הפונקציה
// מחזירה 400, הלקוח מסיק שהאצווה פסולה וזורק אותה, והאירוע נעלם.
// שתיים מהשכבות אינן TypeScript, ולכן הבדיקה כאן.
//
// כאן נבדק גם חוזה *העמודות*: השדות שהפונקציה מכניסה חייבים להיות בדיוק
// העמודות שהטבלה מכירה, וכל עמודה חיונית חייבת להגיע מהלקוח.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, sanitizeRow } from '../../netlify/functions/lib/event-schema';
import type { EndScreen } from '../engine/types';
import type { EventType } from './events';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/**
 * הרשימה מצד הלקוח, כמפתחות של Record — כך שסוג חדש ב-EventType מפיל
 * את הקומפילציה כאן ולא נשכח בשתי השכבות האחרות.
 */
const CLIENT_EVENT_TYPES: Record<EventType, true> = {
  session_start: true,
  screen_view: true,
  answer: true,
  complete: true,
  screenout: true,
  quotafull: true,
};
const clientTypes = Object.keys(CLIENT_EVENT_TYPES).sort();

const END_VARIANTS: EndScreen['variant'][] = ['complete', 'screenout', 'quotafull'];

describe('event type list stays in sync across the three layers', () => {
  it('the server accepts exactly the types the client sends', () => {
    expect([...EVENT_TYPES].sort()).toEqual(clientTypes);
  });

  it('the survey_events check constraint accepts exactly those types', () => {
    const sql = read('supabase/schema.sql');
    // האילוץ המפורש (ה-alter) הוא זה שחל גם על התקנה קיימת
    const constraint = sql.match(
      /add constraint survey_events_event_type_check\s*check \(event_type in \(([^)]*)\)\)/,
    )?.[1];
    expect(constraint, 'event_type check constraint not found in schema.sql').toBeDefined();
    const allowed = [...constraint!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual(clientTypes);
  });

  it('every end-screen variant is a loggable event type (quotafull is not a screenout)', () => {
    for (const variant of END_VARIANTS) {
      const asEvent: EventType = variant;
      expect(EVENT_TYPES.has(asEvent)).toBe(true);
    }
  });

  it('the completed_responses view counts every terminal event', () => {
    const sql = read('supabase/schema.sql');
    const view = sql.slice(
      sql.indexOf('create or replace view public.completed_responses'),
      sql.indexOf('revoke all on public.completed_responses'),
    );
    const filters = [...view.matchAll(/event_type in \(([^)]*)\)/g)].map((m) => m[1]);
    expect(filters.length).toBeGreaterThan(0);
    for (const filter of filters) {
      for (const variant of END_VARIANTS) expect(filter).toContain(`'${variant}'`);
    }
  });
});

/** העמודות של survey_events כפי שהן מוגדרות ב-schema.sql. */
function surveyEventsColumns(): { name: string; def: string }[] {
  const sql = read('supabase/schema.sql');
  const start = sql.indexOf('create table if not exists public.survey_events');
  const body = sql.slice(sql.indexOf('(', start) + 1, sql.indexOf('\n);', start));
  return body
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => /^[a-z_]+\s+\S/.test(line))
    .map((line) => ({ name: line.split(/\s+/)[0], def: line }));
}

describe('the inserted row matches the survey_events table', () => {
  const row = sanitizeRow({
    event_uid: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    survey_version: '2026-08-09.1-main',
    event_type: 'answer',
    screen_id: 's_age',
    payload: { value: 35, ms: 1200, attempt: 1 },
    client_ts: '2026-08-09T10:00:00.000Z',
  })!;

  it('sends only fields the table has', () => {
    const columns = surveyEventsColumns().map((c) => c.name);
    expect(columns.length).toBeGreaterThan(5);
    for (const field of Object.keys(row)) {
      expect(columns, `survey_events has no column "${field}"`).toContain(field);
    }
  });

  it('sends every column the table demands (not null, no default, not generated)', () => {
    const required = surveyEventsColumns().filter(
      (c) => /not null/.test(c.def) && !/default/.test(c.def) && !/generated/.test(c.def),
    );
    expect(required.length).toBeGreaterThan(0);
    for (const column of required) {
      expect(row, `survey_events.${column.name} is required but never sent`).toHaveProperty(
        column.name,
      );
      expect(row[column.name as keyof typeof row]).not.toBeNull();
    }
  });

  it('is written through the dedup path, so a retry cannot double-count', () => {
    const fn = read('netlify/functions/events.mts');
    expect(fn).toContain('on_conflict=event_uid');
    expect(fn).toContain('resolution=ignore-duplicates');
    // ה-DB הוא שמאכף את הייחודיות בפועל
    expect(read('supabase/schema.sql')).toMatch(/event_uid\s+uuid not null unique/);
  });
});
