// ייצוא ה-raw data של שאלון כ-CSV לגיליון — קריאה בלבד, עורכי first-edea בלבד.
// שורה לכל סשן, עמודה לכל שאלה; ההיפוך והכתיבה ב-src/admin/export.ts (טהור
// ונבדק ביחידות). כאן רק אימות, שאיבה מה-views בדפדוף, וכותרות ההורדה.
// בלי rpc חדש ובלי שינוי schema.sql — הכל מעל session_stats + final_answers,
// שכבר קיימים ומוענקים ל-service_role.
//
//   GET ?survey=<slug>&version=<version|all>&include_test=<1|0>
//     → text/csv (UTF-8 BOM); Content-Disposition עם שם קובץ מדבר
//
// טרי תמיד (no-store) — מייצאים את מה שרואים על המסך, לא קאש.

import { requireAdmin } from './lib/session';
import { supaHeaders, supabaseEnv, type SupabaseEnv } from './lib/supabase';
import { isValidSlug } from '../../src/data/surveys';
import {
  buildExportTable,
  toCsv,
  type ExportAnswer,
  type ExportSession,
  type ExportVersion,
} from '../../src/admin/export';

const NO_STORE = { 'Cache-Control': 'no-store' };
// דף ה-PostgREST המרבי של Supabase; הלולאה מדפדפת עד שהדף חוזר חסר
const PAGE = 1000;
// בלם בטיחות הרבה מעל סקאלת פיילוט — לפני שנתקרב אליו נדבר על ייצוא בזרימה
const MAX_ROWS = 200_000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });

  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const params = new URL(req.url).searchParams;
  const survey = params.get('survey') ?? '';
  if (!isValidSlug(survey)) return new Response('invalid survey', { status: 400 });
  const includeTest = params.get('include_test') === '1';
  const versionParam = params.get('version') ?? 'all';

  const slug = encodeURIComponent(survey);
  const [surveyRes, versionsRes] = await Promise.all([
    fetch(`${env.url}/rest/v1/surveys?slug=eq.${slug}&select=slug`, { headers }),
    fetch(
      `${env.url}/rest/v1/survey_configs?survey_id=eq.${slug}&select=version,config&order=published_at.desc,version.desc`,
      { headers },
    ),
  ]);
  if (!surveyRes.ok || !versionsRes.ok) return new Response('upstream error', { status: 502 });
  if (((await surveyRes.json()) as unknown[]).length === 0) {
    return new Response('survey not found', { status: 404 });
  }
  const versions = (await versionsRes.json()) as ExportVersion[];

  const version = versionParam === 'all' ? null : versionParam;
  if (version !== null && !versions.some((v) => v.version === version)) {
    return new Response('unknown version', { status: 400 });
  }
  const wanted = version === null ? versions : versions.filter((v) => v.version === version);

  // שאלון בלי אף גרסה — אין נתונים בהגדרה; מחזירים גיליון כותרות ריק
  let sessions: ExportSession[] = [];
  let answers: ExportAnswer[] = [];
  if (wanted.length > 0) {
    const sessionFilters = new URLSearchParams({
      select: 'session_id,survey_version,started_at,outcome,answered_any,is_test,vars',
      survey_id: `eq.${survey}`,
      started_at: 'not.is.null',
      order: 'started_at.asc,session_id.asc',
    });
    if (version !== null) sessionFilters.set('survey_version', `eq.${version}`);
    if (!includeTest) sessionFilters.set('is_test', 'is.false');

    // final_answers אינו נושא survey_id — הסינון לשאלון הוא דרך רשימת הגרסאות
    // שלו (ראו schema.sql). ציטוט כפול מגן על נקודות/מקפים שבשמות הגרסאות.
    const inList = wanted.map((v) => `"${v.version.replaceAll('"', '\\"')}"`).join(',');
    const answerFilters = new URLSearchParams({
      select: 'session_id,screen_id,value',
      survey_version: `in.(${inList})`,
      order: 'session_id.asc,screen_id.asc',
    });

    const [sessionRows, answerRows] = await Promise.all([
      fetchAll<ExportSession>(env, 'session_stats', sessionFilters),
      fetchAll<ExportAnswer>(env, 'final_answers', answerFilters),
    ]);
    if (sessionRows instanceof Response) return sessionRows;
    if (answerRows instanceof Response) return answerRows;
    sessions = sessionRows;
    answers = answerRows;
  }

  const csv = toCsv(buildExportTable(sessions, answers, wanted));
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${survey}-${version ?? 'all'}-${stamp}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...NO_STORE,
    },
  });
};

/** שאיבת כל שורות ה-view בדפי PAGE; Response = כשל upstream או חריגת MAX_ROWS */
async function fetchAll<T>(
  env: SupabaseEnv,
  view: string,
  filters: URLSearchParams,
): Promise<T[] | Response> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    if (rows.length > MAX_ROWS) return new Response('too many rows to export', { status: 413 });
    const q = new URLSearchParams(filters);
    q.set('limit', String(PAGE));
    q.set('offset', String(offset));
    const res = await fetch(`${env.url}/rest/v1/${view}?${q.toString()}`, {
      headers: supaHeaders(env.key),
    });
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
