// מצב המכסות של שאלון: כמה משיבים כבר סיימו עם כל ערך שיש עליו תקרה.
// קצה ציבורי בלי אימות, כמו config-get — המשיב קורא לו בכניסה, לפני שיש סשן
// כלשהו. ה-service_role key נשאר בצד השרת ולעולם לא נשלח ללקוח.
//
// ההשוואה מול התקרה נעשית בדפדפן ולא כאן, בכוונה: הקונפיג של המשיב מוצמד
// לגרסה שבה התחיל (config-get), והתקרות שרלוונטיות לו הן אלה שבגרסה שלו —
// לא אלה שבטיוטה שפורסמה מאז.
//
// ⚠ מה שנחשף כאן הוא ספירות מצטברות לערכים שהוגדרה להם מכסה, ולא יותר: אין
// רשימת סימונים חופשית ואין גישה ל-vars של סשן. התקרות עצמן ממילא ציבוריות —
// הן חלק מהקונפיג ש-config-get מגיש לכל משיב.
//
// כשל כלשהו כאן מוחזר כשגיאה, והלקוח ממשיך כאילו אף מכסה לא מלאה (fail open):
// תקלה אצלנו לא חוסמת משיבים אמיתיים.
//
//   GET ?survey=<slug> → { survey, version, counts: { <mark>: { <value>: n } } }

import { json, rpc, supaHeaders, supabaseEnv } from './lib/supabase';
import { DEFAULT_SURVEY_SLUG, isValidSlug } from '../../src/data/surveys';
import { quotaCells } from '../../src/engine/quota';
import type { SurveyConfig } from '../../src/engine/types';

interface CountRow {
  mark: string;
  value: string | null;
  n: number;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const env = supabaseEnv();
  if (env instanceof Response) return env;

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });

  // הגרסה הפעילה היא שקובעת אילו סימונים בכלל נספרים. שאלון שלא פורסם מעולם
  // אינו שגיאה כאן — פשוט אין לו מכסות.
  const res = await fetch(
    `${env.url}/rest/v1/survey_configs?survey_id=eq.${encodeURIComponent(slug)}` +
      `&select=version,config&order=published_at.desc&limit=1`,
    { headers: supaHeaders(env.key) },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });

  const rows = (await res.json()) as { version: string; config: SurveyConfig }[];
  if (rows.length === 0) return quotaResponse(slug, null, {});

  const { version, config } = rows[0];
  const marks = [...new Set(quotaCells(config).map((cell) => cell.mark))];
  if (marks.length === 0) return quotaResponse(slug, version, {});

  const counted = await rpc(env, 'quota_counts', { p_survey: slug, p_marks: marks });
  if (counted instanceof Response) return counted;

  const counts: Record<string, Record<string, number>> = {};
  for (const row of counted as CountRow[]) {
    // ערך null = סשן שסיים בלי הסימון הזה בכלל; אין לו משבצת לספור לתוכה
    if (row.value === null) continue;
    (counts[row.mark] ??= {})[row.value] = row.n;
  }
  return quotaResponse(slug, version, counts);
};

function quotaResponse(
  survey: string,
  version: string | null,
  counts: Record<string, Record<string, number>>,
): Response {
  return json({ survey, version, counts }, 200, {
    // דקה של cache: הספירה מקורבת ממילא (ראו engine/quota.ts), והקצה הזה
    // נקרא בכל כניסה לשאלון — כולל בגל תנועה שכולו מגיע מאותה הפצה.
    'Cache-Control': 'public, max-age=60, must-revalidate',
  });
}
