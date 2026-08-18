// Append-only event delivery via the Netlify Function (/.netlify/functions/events).
// No Supabase URL or key exists in the browser bundle — the function holds the
// credentials server-side and is the only write path to the database.
// Design constraints:
// - Sending must never block navigation between screens (fire-and-forget + retry queue).
// - A refresh or retry must not double-count events (client-generated event_uid,
//   deduplicated server-side with ON CONFLICT DO NOTHING).
// - In dev (vite) events go to console + localStorage only; the real pipeline
//   runs in production builds (`netlify serve` locally, or the deployed site).

import { scopedKey } from './session-scope';

const ENDPOINT = '/.netlify/functions/events';

export const eventsEnabled = import.meta.env.PROD;

// ⚠ This list is duplicated in three places that must stay in sync: here,
// EVENT_TYPES in netlify/functions/events.mts, and the check on survey_events in
// supabase/schema.sql. A type the server does not recognise fails the whole
// batch with a 400, and the client throws it away — the event is lost silently.
// The three end types are derived from EndScreen['variant'] and carry the same
// names.
export type EventType =
  | 'session_start'
  | 'screen_view'
  | 'answer'
  | 'complete'
  | 'screenout'
  | 'quotafull';

interface EventRow {
  event_uid: string;
  session_id: string;
  survey_version: string;
  event_type: EventType;
  screen_id: string | null;
  payload: Record<string, unknown>;
  client_ts: string;
}

// The queue is shared across surveys (each row carries its own survey_version),
// but the session_id is scoped to the survey — otherwise opening a second survey
// in the same tab would be counted as the same session.
const QUEUE_KEY = 'sq_queue_v1';
const DEV_KEY = 'sq_dev_events_v1';
const SESSION_KEY = 'sq_session_v1';

function loadQueue(): EventRow[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as EventRow[];
  } catch {
    return [];
  }
}

let queue: EventRow[] = loadQueue();
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function persistQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* Storage quota full — we carry on from memory only */
  }
}

export function getSessionId(): string {
  const key = scopedKey(SESSION_KEY);
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function logEvent(
  surveyVersion: string,
  type: EventType,
  screenId: string | null,
  payload: Record<string, unknown> = {},
): void {
  const row: EventRow = {
    event_uid: crypto.randomUUID(),
    session_id: getSessionId(),
    survey_version: surveyVersion,
    event_type: type,
    screen_id: screenId,
    payload,
    client_ts: new Date().toISOString(),
  };

  if (!eventsEnabled) {
    console.info('[survey:dev-mode]', row.event_type, row.screen_id ?? '', row.payload);
    try {
      const dev = JSON.parse(localStorage.getItem(DEV_KEY) ?? '[]') as EventRow[];
      dev.push(row);
      localStorage.setItem(DEV_KEY, JSON.stringify(dev));
    } catch {
      /* ignore */
    }
    return;
  }

  queue.push(row);
  persistQueue();
  void flush();
}

function scheduleRetry(ms: number) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, ms);
}

async function flush(keepalive = false): Promise<void> {
  if (!eventsEnabled || flushing || queue.length === 0) return;
  flushing = true;
  // keepalive is capped at 64KB — send in small batches
  const batch = queue.slice(0, 20);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (res.ok) {
      queue = queue.slice(batch.length);
      persistQueue();
      if (queue.length > 0) scheduleRetry(250);
    } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      // The batch is invalid — retrying will not help; drop it rather than block forever
      console.warn('[survey] batch rejected', res.status);
      queue = queue.slice(batch.length);
      persistQueue();
      if (queue.length > 0) scheduleRetry(250);
    } else {
      scheduleRetry(5000);
    }
  } catch {
    scheduleRetry(5000);
  } finally {
    flushing = false;
  }
}

// A last attempt to drain the queue when the page closes or goes to the background
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });
}
