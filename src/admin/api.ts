// שכבת הגישה של קונסולת הניהול לפונקציות ה-Netlify.
// כל קריאה נושאת את ה-access token של Supabase Auth ככותרת Bearer;
// הפונקציה מאמתת אותו מול Supabase ואוכפת את הדומיין (lib/session.ts).
// כל קצוות הטיוטה והפרסום מקבלים ?survey=<slug> — הן פועלות על שאלון אחד.

import type { SurveyConfig } from '../engine/types';
import type { ValidationIssue } from '../engine/validate';
import { accessToken } from './supabaseClient';

/** טוקן חסר/פג — צריך להתחבר מחדש. */
export class UnauthorizedError extends Error {}
/** מחובר, אבל החשבון לא מורשה (לא בדומיין first-edea.com). */
export class ForbiddenError extends Error {}

/** כשל שאינו 401/403 — נושא את קוד הסטטוס כדי שנוכל להסביר לעורך. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `request failed: ${status}`);
  }
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new UnauthorizedError();
  const res = await fetch(`/.netlify/functions/${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) throw new ForbiddenError(await res.text());
  return res;
}

const jsonInit = { 'Content-Type': 'application/json' };

// ---------- שאלונים ----------

export interface SurveySummary {
  slug: string;
  name: string;
  created_at: string;
  created_by: string;
  archived_at: string | null;
  has_draft: boolean;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
  /** כמה גרסאות פורסמו; 0 ⇒ מותר למחוק את השאלון לגמרי */
  versions: number;
  latest_version: string | null;
  latest_published_at: string | null;
}

export async function listSurveys(): Promise<SurveySummary[]> {
  const res = await call('admin-surveys');
  if (!res.ok) throw new ApiError(res.status);
  return ((await res.json()) as { surveys: SurveySummary[] }).surveys;
}

export async function createSurvey(slug: string, name: string): Promise<void> {
  const res = await call('admin-surveys', {
    method: 'POST',
    headers: jsonInit,
    body: JSON.stringify({ slug, name }),
  });
  if (!res.ok) throw new ApiError(res.status);
}

export async function updateSurvey(
  slug: string,
  patch: { name?: string; archived?: boolean },
): Promise<void> {
  const res = await call('admin-surveys', {
    method: 'PATCH',
    headers: jsonInit,
    body: JSON.stringify({ slug, ...patch }),
  });
  if (!res.ok) throw new ApiError(res.status);
}

export async function deleteSurvey(slug: string): Promise<void> {
  const res = await call(`admin-surveys?survey=${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status);
}

// ---------- טיוטה ----------

export interface DraftData {
  config: SurveyConfig | null;
  updated_at: string | null;
}

export async function getDraft(slug: string): Promise<DraftData> {
  const res = await call(`admin-draft?survey=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new ApiError(res.status, `draft load failed: ${res.status}`);
  return (await res.json()) as DraftData;
}

export class ConflictError extends Error {}

/** כשל שמירה שאינו 401/403/409 — נושא את קוד הסטטוס כדי שנוכל להסביר לעורך. */
export class SaveFailedError extends Error {
  constructor(readonly status: number) {
    super(`draft save failed: ${status}`);
  }
}

export async function saveDraft(
  slug: string,
  config: SurveyConfig,
  expectedUpdatedAt: string | null,
): Promise<{ updated_at: string }> {
  const res = await call(`admin-draft?survey=${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: jsonInit,
    body: JSON.stringify({ config, expected_updated_at: expectedUpdatedAt }),
  });
  if (res.status === 409) throw new ConflictError();
  if (!res.ok) throw new SaveFailedError(res.status);
  return (await res.json()) as { updated_at: string };
}

// ---------- סטטיסטיקות ----------

export interface StatsOverview {
  total_sessions: number;
  completed: number;
  screened_out: number;
  quota_full: number;
  abandoned_mid: number;
  abandoned_bounce: number;
}

export interface StatsVersion {
  version: string;
  published_at: string;
  /** הקונפיג שפורסם — פענוח נוסחים, סדר מסכים ותוויות נעשה בדפדפן, לא ב-SQL */
  config: SurveyConfig;
}

export interface FunnelStat {
  screen_id: string;
  viewed: number;
  answered: number;
  dropped_here: number;
  /** חציון זמן ניסיון-ראשון במסך; null כשאין תשובות */
  median_ms: number | null;
}

export interface DistStat {
  screen_id: string;
  /** פריט מטריצה; null לשאלות שאינן מטריצה */
  item_id: string | null;
  /** מזהה האפשרות / הציון / הערך — טקסט גולמי; התווית נפתרת מהקונפיג בדפדפן */
  answer_key: string;
  /** ערך מימד הפילוח; null = בלי פילוח, או סשן שהמימד לא ידוע עבורו */
  dim_value: string | null;
  n: number;
}

export interface BaseStat {
  screen_id: string;
  dim_value: string | null;
  /** כמה סשנים ענו על המסך בקבוצת המימד — מכנה אחוזי הפילוח */
  answered: number;
}

export interface StatsBundle {
  survey: string;
  name: string;
  versions: StatsVersion[];
  overview: StatsOverview;
  funnel: FunnelStat[];
  distributions: DistStat[];
  /** מימד הפילוח שהוחזר, או null */
  by: string | null;
  bases: BaseStat[];
}

/** צרור הסטטיסטיקות של שאלון; version='all' = כל הגרסאות יחד (ברירת המחדל). */
export async function getStats(
  slug: string,
  opts: { version?: string; includeTest?: boolean; by?: string } = {},
): Promise<StatsBundle> {
  const params = new URLSearchParams({ survey: slug });
  if (opts.version && opts.version !== 'all') params.set('version', opts.version);
  if (opts.includeTest) params.set('include_test', '1');
  if (opts.by) params.set('by', opts.by);
  const res = await call(`admin-stats?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as StatsBundle;
}

// ---------- תשובות פתוחות ----------

export interface OpenAnswerStats {
  screen_id: string;
  answered: number;
  skipped: number;
  abandoned: number;
  len_min: number | null;
  len_median: number | null;
  len_p90: number | null;
  len_max: number | null;
}

export interface OpenAnswerRow {
  screen_id: string;
  /** הטקסט הגולמי, כלשונו — שום ניתוח תוכן */
  value: string;
  created_at: string;
  survey_version: string;
  segment: string | null;
  outcome: string;
}

export interface OpenAnswersPage {
  stats: OpenAnswerStats[];
  total: number;
  rows: OpenAnswerRow[];
}

export async function getOpenAnswers(
  slug: string,
  opts: {
    screens: string[];
    version?: string;
    includeTest?: boolean;
    segment?: string;
    limit?: number;
    offset?: number;
  },
): Promise<OpenAnswersPage> {
  const params = new URLSearchParams({ survey: slug, screens: opts.screens.join(',') });
  if (opts.version && opts.version !== 'all') params.set('version', opts.version);
  if (opts.includeTest) params.set('include_test', '1');
  if (opts.segment) params.set('segment', opts.segment);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const res = await call(`admin-answers?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as OpenAnswersPage;
}

// ---------- ייצוא ----------

/**
 * מוריד את ה-raw data כ-CSV (שורה לסשן, עמודה לשאלה) — הקובץ נבנה בשרת
 * (admin-export) וחוזר כ-Blob מוכן להורדה. שם הקובץ מגיע מהשרת.
 */
export async function fetchExportCsv(
  slug: string,
  opts: { version?: string; includeTest?: boolean } = {},
): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams({ survey: slug });
  if (opts.version && opts.version !== 'all') params.set('version', opts.version);
  if (opts.includeTest) params.set('include_test', '1');
  const res = await call(`admin-export?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status);
  const match = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? `${slug}.csv` };
}

// ---------- פרסום ----------

export interface PublishResult {
  version?: string;
  warnings?: ValidationIssue[];
  errors?: ValidationIssue[];
}

export async function publish(
  slug: string,
  label: string,
): Promise<{ status: number; data: PublishResult }> {
  const res = await call(`admin-publish?survey=${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: jsonInit,
    body: JSON.stringify({ label }),
  });
  const data = res.status === 200 || res.status === 422 ? ((await res.json()) as PublishResult) : {};
  return { status: res.status, data };
}
