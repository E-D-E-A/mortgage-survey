// קצה קריאה ציבורי לקונפיג השאלון. בלי אימות — הקונפיג ממילא מוצג לכל משיב.
// ?version=<v> מחזיר גרסה מוצמדת (immutable — סשן שהתחיל בה ממשיך איתה),
// בלי פרמטר מחזיר את הגרסה האחרונה שפורסמה.

const MAX_VERSION_CHARS = 100;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return new Response('server not configured', { status: 503 });
  }

  const version = new URL(req.url).searchParams.get('version');
  if (version !== null && (version.length === 0 || version.length > MAX_VERSION_CHARS)) {
    return new Response('invalid version', { status: 400 });
  }

  const query = version
    ? `version=eq.${encodeURIComponent(version)}&select=version,config&limit=1`
    : `select=version,config&order=published_at.desc&limit=1`;

  const res = await fetch(`${supaUrl}/rest/v1/survey_configs?${query}`, {
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
  });
  if (!res.ok) {
    return new Response('upstream error', { status: 502 });
  }

  const rows = (await res.json()) as { version: string; config: unknown }[];
  if (rows.length === 0) {
    return new Response('not found', { status: 404 });
  }

  return new Response(JSON.stringify(rows[0]), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // גרסה מוצמדת לעולם לא משתנה (trigger בסכמה) — אפשר cache אגרסיבי.
      // הגרסה הפעילה מתעדכנת בפרסום — cache קצר בלבד.
      'Cache-Control': version
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60, must-revalidate',
    },
  });
};
