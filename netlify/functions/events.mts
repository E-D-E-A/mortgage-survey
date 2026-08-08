// קצה כתיבה יחיד לאירועי השאלון. הדפדפן שולח לכאן — בלי שום מפתח.
// המפתחות (service_role) חיים רק בסביבת השרת של Netlify ולעולם לא נשלחים ללקוח.
// service_role עוקף RLS, ולכן כל האכיפה נמצאת כאן: whitelist שדות, enum, מגבלות גודל.

// ⚠ חייב להישאר מסונכרן עם EventType ב-src/data/events.ts ועם ה-check על
// survey_events ב-supabase/schema.sql — סוג חסר כאן מפיל אצווה שלמה ל-400.
const EVENT_TYPES = new Set([
  'session_start',
  'screen_view',
  'answer',
  'complete',
  'screenout',
  'quotafull',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 20;
const MAX_BODY_BYTES = 200_000;
const MAX_PAYLOAD_CHARS = 50_000;

interface EventRow {
  event_uid: string;
  session_id: string;
  survey_version: string;
  event_type: string;
  screen_id: string | null;
  payload: Record<string, unknown>;
  client_ts: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// מחזיר שורה נקייה (רק השדות המוכרים) או null אם השורה פסולה.
function sanitizeRow(raw: unknown): EventRow | null {
  if (!isPlainObject(raw)) return null;
  const { event_uid, session_id, survey_version, event_type, screen_id, payload, client_ts } = raw;
  if (typeof event_uid !== 'string' || !UUID_RE.test(event_uid)) return null;
  if (typeof session_id !== 'string' || !UUID_RE.test(session_id)) return null;
  if (typeof survey_version !== 'string' || survey_version.length === 0 || survey_version.length > 100) return null;
  if (typeof event_type !== 'string' || !EVENT_TYPES.has(event_type)) return null;
  if (screen_id !== null && (typeof screen_id !== 'string' || screen_id.length > 200)) return null;
  if (!isPlainObject(payload) || JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return null;
  if (typeof client_ts !== 'string' || Number.isNaN(Date.parse(client_ts))) return null;
  return { event_uid, session_id, survey_version, event_type, screen_id, payload, client_ts };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return new Response('server not configured', { status: 503 });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return new Response('payload too large', { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  if (!Array.isArray(body) || body.length === 0 || body.length > MAX_BATCH) {
    return new Response('expected 1-20 events', { status: 400 });
  }

  const rows: EventRow[] = [];
  for (const raw of body) {
    const row = sanitizeRow(raw);
    if (!row) return new Response('invalid event', { status: 400 });
    rows.push(row);
  }

  // on_conflict + ignore-duplicates: retry מהלקוח לא יוצר כפילויות (event_uid ייחודי)
  const res = await fetch(`${supaUrl}/rest/v1/survey_events?on_conflict=event_uid`, {
    method: 'POST',
    headers: {
      apikey: supaKey,
      Authorization: `Bearer ${supaKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });

  if (res.ok || res.status === 409) {
    return new Response(null, { status: 204 });
  }
  return new Response('upstream error', { status: 502 });
};
