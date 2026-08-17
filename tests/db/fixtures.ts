// Fixture helpers for the DB tests. Each test file gets a unique two-character
// hexadecimal prefix and a slug of its own — vitest runs files in parallel
// against the same DB, and isolating the ids is what keeps files from colliding.
import type { Sql } from './harness';

const hex12 = (n: number) => n.toString(16).padStart(12, '0').slice(-12);

/**
 * Deterministic session/event ids, in a separate range per test file.
 *
 * ⚠ The prefix becomes the first two characters of a uuid, so it has to be
 * hexadecimal. A prefix like 'g7' produces ids Postgres rejects, and the failure
 * surfaces from deep inside resetEvents as "invalid input syntax for type uuid"
 * with nothing pointing at the prefix that caused it.
 */
export function idFactory(filePrefix: string) {
  if (!/^[0-9a-f]{2}$/.test(filePrefix)) {
    throw new Error(`idFactory prefix must be two hex characters, got "${filePrefix}"`);
  }
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
  /** An offset in minutes from a fixed base point — the chronological order of a session's events */
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
  // survey_configs is deliberately append-only (a trigger blocks update/delete),
  // but a fixture needs replace semantics — otherwise a wrong row from an older run
  // is stuck there forever. In the disposable local DB that is allowed: disable the
  // trigger inside a locked transaction, delete and insert fresh. The advisory lock
  // serialises parallel files.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(732913)`;
    await tx`alter table survey_configs disable trigger survey_configs_immutable`;
    await tx`delete from survey_configs where version in ${tx(versions.map((v) => v.version))}`;
    for (const v of versions) {
      await tx`insert into survey_configs (version, survey_id, config, published_by)
               values (${v.version}, ${slug},
                       ${tx.json((v.config ?? { version: v.version, screens: [] }) as Parameters<Sql['json']>[0])},
                       'test')`;
    }
    await tx`alter table survey_configs enable trigger survey_configs_immutable`;
  });
}

/** Deletes the given versions' events and inserts the fixture — so a re-run starts clean */
export async function resetEvents(sql: Sql, versions: string[], events: EventFixture[]): Promise<void> {
  await sql`delete from survey_events where survey_version in ${sql(versions)}`;
  if (events.length === 0) return;
  // The insert travels as a single jsonb parameter and is expanded server-side —
  // that keeps payload a real jsonb object (and not a string-inside-jsonb, a double
  // encoding that breaks every payload -> 'vars')
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

/** A whole session's events in shorthand: start → views/answers → an optional end event */
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
