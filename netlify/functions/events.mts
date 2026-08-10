// קצה כתיבה יחיד לאירועי השאלון. הדפדפן שולח לכאן — בלי שום מפתח.
// המפתחות (service_role) חיים רק בסביבת השרת של Netlify ולעולם לא נשלחים ללקוח.
//
// חוזה השורה עצמו (whitelist שדות, enum, מגבלות גודל) יושב ב-lib/event-schema.ts,
// כדי שהבדיקות יוכלו להריץ את השורות שהדפדפן מייצר דרך אותו קוד בדיוק.

import { MAX_BATCH, MAX_BODY_BYTES, sanitizeRow, type EventRow } from './lib/event-schema';

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
