// טיוטת שאלון (שורה אחת לכל שאלון). עורכי first-edea בלבד (requireAdmin לפני הכל).
// הפרמטר ?survey=<slug> בוחר את השאלון; בהיעדרו — שאלון ברירת המחדל.
// GET → { config, updated_at } | { config: null }
// PUT { config, expected_updated_at } → שמירה עם נעילה אופטימית:
//   expected_updated_at שאינו תואם ל-DB ⇒ 409 (מישהו שמר במקביל).
// טיוטה מותרת להיות לא-תקינה — הוולידציה חוסמת רק פרסום.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { DEFAULT_SURVEY_SLUG, isValidSlug } from '../../src/data/surveys';

const MAX_CONFIG_BYTES = 500_000;

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });
  const scope = `survey_id=eq.${encodeURIComponent(slug)}`;

  if (req.method === 'GET') {
    const res = await fetch(
      `${env.url}/rest/v1/survey_drafts?${scope}&select=config,updated_at`,
      { headers },
    );
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const rows = (await res.json()) as { config: unknown; updated_at: string }[];
    return json(rows.length > 0 ? rows[0] : { config: null, updated_at: null });
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

  if (expected === null) {
    // יצירת הטיוטה הראשונה של השאלון; אם כבר קיימת — 409 (מישהו הקדים).
    // שאלון שלא קיים נחסם ע"י ה-FK ומחזיר 409 מ-PostgREST; מפרידים בין
    // השניים כדי לא להציג לעורך "מישהו הקדים אותך" על שאלון שנמחק.
    const res = await fetch(`${env.url}/rest/v1/survey_drafts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        survey_id: slug,
        config,
        updated_at: now,
        updated_by: session.email,
      }),
    });
    if (res.status === 409) {
      const detail = await res.text();
      return detail.includes('survey_drafts_survey_id_fkey')
        ? new Response('survey not found', { status: 404 })
        : new Response('draft already exists', { status: 409 });
    }
    if (!res.ok) return new Response('upstream error', { status: 502 });
    return json({ updated_at: now });
  }

  const res = await fetch(
    `${env.url}/rest/v1/survey_drafts?${scope}&updated_at=eq.${encodeURIComponent(expected as string)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ config, updated_at: now, updated_by: session.email }),
    },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const updated = (await res.json()) as unknown[];
  if (updated.length === 0) {
    // הטיוטה השתנתה מאז שנטענה — שמירה נדחית כדי לא לדרוס
    return new Response('draft changed concurrently', { status: 409 });
  }
  return json({ updated_at: now });
};
