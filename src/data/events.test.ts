// The list of event types lives in three layers: the client, the Netlify
// Function and the Postgres constraint. A type present in one and missing from
// another fails in the most dangerous way possible — the function returns 400,
// the client concludes the batch is invalid and throws it away, and the event
// disappears. They share no type (two of them are not TypeScript), which is why
// the check lives here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EndScreen } from '../engine/types';
import type { EventType } from './events';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const EVENT_TYPES: EventType[] = [
  'session_start',
  'screen_view',
  'answer',
  'complete',
  'screenout',
  'quotafull',
];

const END_VARIANTS: EndScreen['variant'][] = ['complete', 'screenout', 'quotafull'];

describe('event type list stays in sync across the three layers', () => {
  it('the Netlify function accepts exactly the types the client sends', () => {
    const fn = read('netlify/functions/events.mts');
    const declared = fn.match(/const EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/)?.[1];
    expect(declared, 'EVENT_TYPES not found in events.mts').toBeDefined();
    const accepted = [...declared!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(accepted.sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('the survey_events check constraint accepts exactly those types', () => {
    const sql = read('supabase/schema.sql');
    // The explicit constraint (the alter) is the one that also applies to an existing installation
    const constraint = sql.match(
      /add constraint survey_events_event_type_check\s*check \(event_type in \(([^)]*)\)\)/,
    )?.[1];
    expect(constraint, 'event_type check constraint not found in schema.sql').toBeDefined();
    const allowed = [...constraint!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('every end-screen variant is a loggable event type (quotafull is not a screenout)', () => {
    for (const variant of END_VARIANTS) {
      const asEvent: EventType = variant;
      expect(EVENT_TYPES).toContain(asEvent);
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
