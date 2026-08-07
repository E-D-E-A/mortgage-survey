// טיוטת השאלון (שורה יחידה). עורכי first-edea בלבד (requireAdmin לפני הכל).
// GET → { config, updated_at } | { config: null }
// PUT { config, expected_updated_at } → שמירה עם נעילה אופטימית:
//   expected_updated_at שאינו תואם ל-DB ⇒ 409 (מישהו שמר במקביל).
// טיוטה מותרת להיות לא-תקינה — הוולידציה חוסמת רק פרסום.

import { requireAdmin } from './lib/session';

const MAX_CONFIG_BYTES = 500_000;

function supaHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export default async (req: Request): Promise<Response> => {
  const session = requireAdmin(req);
  if (session instanceof Response) return session;

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return new Response('server not configured', { status: 503 });
  }

  if (req.method === 'GET') {
    const res = await fetch(`${supaUrl}/rest/v1/survey_drafts?id=eq.1&select=config,updated_at`, {
      headers: supaHeaders(supaKey),
    });
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const rows = (await res.json()) as { config: unknown; updated_at: string }[];
    const body = rows.length > 0 ? rows[0] : { config: null, updated_at: null };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'PUT') {
    return new Response('method not allowed', { status: 405 });
  }

  const text = await req.text();
  if (text.length > MAX_CONFIG_BYTES) {
    return new Response('config too large', { status: 413 });
  }

  let config: unknown;
  let expected: unknown;
  try {
    ({ config, expected_updated_at: expected } = JSON.parse(text) as {
      config?: unknown;
      expected_updated_at?: unknown;
    });
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  const isShapeOk =
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as { screens?: unknown }).screens);
  if (!isShapeOk || (expected !== null && typeof expected !== 'string')) {
    return new Response('invalid draft', { status: 400 });
  }

  const now = new Date().toISOString();
  const row = { id: 1, config, updated_at: now, updated_by: session.email };

  if (expected === null) {
    // יצירת הטיוטה הראשונה; אם כבר קיימת — 409 (מישהו הקדים)
    const res = await fetch(`${supaUrl}/rest/v1/survey_drafts`, {
      method: 'POST',
      headers: { ...supaHeaders(supaKey), Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (res.status === 409) return new Response('draft already exists', { status: 409 });
    if (!res.ok) return new Response('upstream error', { status: 502 });
    return new Response(JSON.stringify({ updated_at: now }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch(
    `${supaUrl}/rest/v1/survey_drafts?id=eq.1&updated_at=eq.${encodeURIComponent(expected as string)}`,
    {
      method: 'PATCH',
      headers: { ...supaHeaders(supaKey), Prefer: 'return=representation' },
      body: JSON.stringify({ config, updated_at: now, updated_by: session.email }),
    },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const updated = (await res.json()) as unknown[];
  if (updated.length === 0) {
    // הטיוטה השתנתה מאז שנטענה — שמירה נדחית כדי לא לדרוס
    return new Response('draft changed concurrently', { status: 409 });
  }
  return new Response(JSON.stringify({ updated_at: now }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
