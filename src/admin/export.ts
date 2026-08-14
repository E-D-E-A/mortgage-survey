// ייצוא תשובות לגיליון: היפוך (סשן, מסך, ערך) לטבלה רחבה — שורה לכל סשן,
// עמודה לכל שאלה — וכתיבת CSV שנפתח נקי ב-Google Sheets וב-Excel.
// לוגיקה טהורה בלבד, בלי רשת ובלי React — פונקציית ה-Netlify (admin-export)
// קוראת לה בצד השרת, והבדיקות ב-export.test.ts מכסות אותה בלי DB.
//
// מוסכמות הטבלה:
//   שתי שורות כותרת (כמו בכלי סקרים מקובלים): שורה 1 מזהים יציבים לניתוח,
//   שורה 2 תוויות עברית לקריאה אנושית.
//   ערכי תשובה נשארים קודי אנליזה (docs/codebook.md); תוויות עברית מופיעות
//   רק בעמודות בחירה, שם הקוד לבדו אינו קריא.
//   מטריצה נפרסת לעמודה לכל פריט (screen.item); רב-ברירה מצטרפת ב-"; ".
//   דילוג מכוון (value=null) ומסך שלא נשאל — שניהם תא ריק.

import type { Screen, SurveyConfig } from '../engine/types';

/** שורת סשן כפי שהיא חוזרת מה-view session_stats (רק העמודות שהייצוא צורך) */
export interface ExportSession {
  session_id: string;
  survey_version: string;
  started_at: string;
  outcome: 'complete' | 'screenout' | 'quotafull' | null;
  answered_any: boolean;
  is_test: boolean;
  vars: Record<string, unknown> | null;
}

/** שורת תשובה סופית מה-view final_answers */
export interface ExportAnswer {
  session_id: string;
  screen_id: string;
  value: unknown;
}

export interface ExportVersion {
  version: string;
  config: SurveyConfig;
}

/** תא בטבלה: מספרים נשארים מספרים כדי שה-CSV לא יעטוף אותם ולא יגן עליהם */
export type Cell = string | number;

const ANSWERABLE = new Set<Screen['type']>(['consent', 'single', 'multi', 'matrix', 'number', 'text']);

const screenPrompt = (s: Screen): string =>
  'prompt' in s && s.prompt ? s.prompt : 'title' in s && s.title ? s.title : s.id;

interface Column {
  id: string;
  label: string;
  cell: (session: ExportSession, answers: Map<string, unknown>) => Cell;
}

/** ערך סשן שנטש — אותה אבחנה כמו stats_overview: ענה משהו מול לא ענה כלל */
const outcomeCode = (s: ExportSession): string =>
  s.outcome ?? (s.answered_any ? 'abandoned_mid' : 'abandoned_bounce');

const scalarCell = (v: unknown): Cell => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

/**
 * תוכנית העמודות ובנייתן. הגרסאות מגיעות מהחדשה לישנה — הקונפיג החדש קובע
 * סדר ותוויות, ומסכים/פריטים/אפשרויות שקיימים רק בגרסאות ישנות מצטרפים
 * אחריו, כך שב"כל הגרסאות" אף תשובה שנאספה אינה נשמטת. מסכים שמופיעים
 * בנתונים אך בשום קונפיג (לא אמור לקרות) נספחים בסוף עם המזהה הגולמי.
 */
export function buildExportTable(
  sessions: ExportSession[],
  answers: ExportAnswer[],
  versions: ExportVersion[],
): Cell[][] {
  const byId = new Map<string, Screen>();
  const screenOrder: string[] = [];
  // תוויות אפשרויות ופריטי מטריצה מאוחדים בין גרסאות — הגרסה החדשה גוברת
  const optionLabels = new Map<string, Map<string, string>>();
  const matrixItems = new Map<string, Map<string, string>>();

  for (const v of versions) {
    for (const screen of v.config.screens) {
      if (!ANSWERABLE.has(screen.type)) continue;
      if (!byId.has(screen.id)) {
        byId.set(screen.id, screen);
        screenOrder.push(screen.id);
      }
      if (screen.type === 'single' || screen.type === 'multi') {
        const labels = optionLabels.get(screen.id) ?? new Map<string, string>();
        for (const o of screen.options) if (!labels.has(o.id)) labels.set(o.id, o.label);
        optionLabels.set(screen.id, labels);
      }
      if (screen.type === 'matrix') {
        const items = matrixItems.get(screen.id) ?? new Map<string, string>();
        for (const i of screen.items) if (!items.has(i.id)) items.set(i.id, i.label);
        matrixItems.set(screen.id, items);
      }
    }
  }

  // תשובות לפי סשן, ואיסוף מסכים/פריטים שקיימים רק בנתונים
  const answersBySession = new Map<string, Map<string, unknown>>();
  const dataOnlyScreens = new Set<string>();
  for (const a of answers) {
    const m = answersBySession.get(a.session_id) ?? new Map<string, unknown>();
    m.set(a.screen_id, a.value);
    answersBySession.set(a.session_id, m);
    if (!byId.has(a.screen_id)) dataOnlyScreens.add(a.screen_id);
    const items = matrixItems.get(a.screen_id);
    if (items && a.value !== null && typeof a.value === 'object' && !Array.isArray(a.value)) {
      for (const itemId of Object.keys(a.value as Record<string, unknown>)) {
        if (!items.has(itemId)) items.set(itemId, itemId);
      }
    }
  }

  const columns: Column[] = [
    { id: 'session_id', label: 'מזהה סשן', cell: (s) => s.session_id },
    { id: 'survey_version', label: 'גרסת שאלון', cell: (s) => s.survey_version },
    { id: 'started_at', label: 'תחילת סשן', cell: (s) => s.started_at },
    { id: 'outcome', label: 'תוצאה', cell: (s) => outcomeCode(s) },
    { id: 'is_test', label: 'סשן בדיקה', cell: (s) => (s.is_test ? 1 : 0) },
  ];

  // עמודות משתני סשן: קודם המוצהרים (varMeta, אז randomVars — בסדר הקונפיג
  // החדש), אחריהם כל מפתח שנצפה בנתונים, לקסיקוגרפית. הערכים — קודים גולמיים.
  const varOrder: string[] = [];
  const seenVars = new Set<string>();
  const pushVar = (name: string) => {
    if (seenVars.has(name)) return;
    seenVars.add(name);
    varOrder.push(name);
  };
  for (const v of versions) {
    for (const name of Object.keys(v.config.varMeta ?? {})) pushVar(name);
    for (const name of Object.keys(v.config.randomVars ?? {})) pushVar(name);
  }
  const dataVars = new Set<string>();
  for (const s of sessions) for (const name of Object.keys(s.vars ?? {})) dataVars.add(name);
  for (const name of [...dataVars].sort()) pushVar(name);

  const varLabel = (name: string): string => {
    for (const v of versions) {
      const label = v.config.varMeta?.[name]?.label;
      if (label) return label;
    }
    return name;
  };
  for (const name of varOrder) {
    columns.push({ id: name, label: varLabel(name), cell: (s) => scalarCell(s.vars?.[name]) });
  }

  for (const screenId of [...screenOrder, ...[...dataOnlyScreens].sort()]) {
    const screen = byId.get(screenId);
    const prompt = screen ? screenPrompt(screen) : screenId;

    if (screen?.type === 'matrix') {
      for (const [itemId, itemLabel] of matrixItems.get(screenId) ?? []) {
        columns.push({
          id: `${screenId}.${itemId}`,
          label: `${prompt} · ${itemLabel}`,
          cell: (_s, ans) => {
            const v = ans.get(screenId);
            if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) return '';
            return scalarCell((v as Record<string, unknown>)[itemId]);
          },
        });
      }
      continue;
    }

    const labels = optionLabels.get(screenId);
    columns.push({
      id: screenId,
      label: prompt,
      cell: (_s, ans) => {
        const v = ans.get(screenId);
        if (v === undefined || v === null) return '';
        if (Array.isArray(v)) {
          return v.map((x) => labels?.get(String(x)) ?? scalarCell(x)).join('; ');
        }
        if (typeof v === 'string' && labels?.has(v)) return labels.get(v) as string;
        return scalarCell(v);
      },
    });
  }

  const empty = new Map<string, unknown>();
  return [
    columns.map((c) => c.id),
    columns.map((c) => c.label),
    ...sessions.map((s) => {
      const ans = answersBySession.get(s.session_id) ?? empty;
      return columns.map((c) => c.cell(s, ans));
    }),
  ];
}

// ─── כתיבת CSV ──────────────────────────────────────────────────────────────

/**
 * תא שמתחיל בתו-נוסחה מקבל גרש מוביל — טקסט חופשי של משיבים זרים נפתח
 * ישירות בגיליון של הצוות, ו-"=IMPORTXML(...)" חייב להישאר טקסט. מינוס
 * מוגן רק כשאינו מספר (‎-5‎ לגיטימי; ‎-=cmd‎ לא). מספרים אמיתיים מגיעים
 * כ-number ואינם עוברים כאן.
 */
const guardFormula = (s: string): string => {
  if (/^[=+@\t\r]/.test(s)) return `'${s}`;
  if (s.startsWith('-') && Number.isNaN(Number(s))) return `'${s}`;
  return s;
};

const escapeCell = (cell: Cell): string => {
  if (typeof cell === 'number') return String(cell);
  const s = guardFormula(cell);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** BOM + CRLF — התנאים שבהם Excel מזהה UTF-8 ועברית לא הופכת לג'יבריש */
export const toCsv = (rows: Cell[][]): string =>
  '\ufeff' + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
