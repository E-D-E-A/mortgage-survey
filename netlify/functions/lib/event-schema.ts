// חוזה שורת האירוע — מה שהדפדפן שולח ומה שנכנס ל-survey_events.
//
// הקובץ הזה הוא מודול טהור בכוונה (בלי process.env, בלי DOM, בלי fetch), כדי
// שגם ה-Netlify Function וגם הבדיקות שרצות בצד הדפדפן ייבאו *אותו* קוד. זה
// אותו דפוס שכבר קיים ב-validateConfig: שער אחד, שני צרכנים, אפס שכפול.
//
// ⚠ EVENT_TYPES מסונכרן עם EventType ב-src/data/events.ts ועם ה-check על
// survey_events ב-supabase/schema.sql — סוג חסר כאן מפיל אצווה שלמה ל-400
// והלקוח זורק אותה, כלומר האירוע נעלם בשקט. הסינכרון נאכף ב-
// src/data/events.test.ts.

export const EVENT_TYPES = new Set([
  'session_start',
  'screen_view',
  'answer',
  'complete',
  'screenout',
  'quotafull',
]);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BATCH = 20;
export const MAX_BODY_BYTES = 200_000;
export const MAX_PAYLOAD_CHARS = 50_000;
export const MAX_VERSION_CHARS = 100;
export const MAX_SCREEN_ID_CHARS = 200;

export interface EventRow {
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

/**
 * מחזיר שורה נקייה (רק השדות המוכרים) או null אם השורה פסולה.
 * service_role עוקף RLS, ולכן זו נקודת האכיפה היחידה: whitelist שדות, enum,
 * מגבלות גודל.
 */
export function sanitizeRow(raw: unknown): EventRow | null {
  if (!isPlainObject(raw)) return null;
  const { event_uid, session_id, survey_version, event_type, screen_id, payload, client_ts } = raw;
  if (typeof event_uid !== 'string' || !UUID_RE.test(event_uid)) return null;
  if (typeof session_id !== 'string' || !UUID_RE.test(session_id)) return null;
  if (
    typeof survey_version !== 'string' ||
    survey_version.length === 0 ||
    survey_version.length > MAX_VERSION_CHARS
  ) {
    return null;
  }
  if (typeof event_type !== 'string' || !EVENT_TYPES.has(event_type)) return null;
  if (screen_id !== null && (typeof screen_id !== 'string' || screen_id.length > MAX_SCREEN_ID_CHARS)) {
    return null;
  }
  if (!isPlainObject(payload) || JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return null;
  if (typeof client_ts !== 'string' || Number.isNaN(Date.parse(client_ts))) return null;
  return { event_uid, session_id, survey_version, event_type, screen_id, payload, client_ts };
}
