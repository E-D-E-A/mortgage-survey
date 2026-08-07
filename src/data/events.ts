// Append-only event delivery via the Netlify Function (/.netlify/functions/events).
// No Supabase URL or key exists in the browser bundle — the function holds the
// credentials server-side and is the only write path to the database.
// Design constraints:
// - Sending must never block navigation between screens (fire-and-forget + retry queue).
// - A refresh or retry must not double-count events (client-generated event_uid,
//   deduplicated server-side with ON CONFLICT DO NOTHING).
// - In dev (vite) events go to console + localStorage only; the real pipeline
//   runs in production builds (`netlify serve` locally, or the deployed site).

const ENDPOINT = '/.netlify/functions/events';

export const eventsEnabled = import.meta.env.PROD;

export type EventType = 'session_start' | 'screen_view' | 'answer' | 'complete' | 'screenout';

interface EventRow {
  event_uid: string;
  session_id: string;
  survey_version: string;
  event_type: EventType;
  screen_id: string | null;
  payload: Record<string, unknown>;
  client_ts: string;
}

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
    /* מכסת אחסון מלאה — נמשיך מהזיכרון בלבד */
  }
}

export function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
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
  // keepalive מוגבל ל-64KB — נשלח באצוות קטנות
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
      // האצווה פסולה — retry לא יעזור; זורקים אותה כדי לא להיתקע לנצח
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

// ניסיון אחרון לרוקן את התור כשהדף נסגר/עובר לרקע
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });
}
