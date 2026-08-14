// עריכות ברמת השאלון על משתני הסשן, כפונקציות טהורות: הגדרת סימון, הגדרת ערך,
// יצירה ומחיקה של הגרלה, ועריכת רשימת הערכים שלה — וגם איתור כל מה שעדיין
// מפנה למשתנה, לפני שמוחקים אותו.
//
// טהורות ובלי React, מאותה סיבה שבגללה edits.ts קיים: זו הלוגיקה שאפשר וצריך
// לבדוק ביחידה, והרכיב שמעליה נשאר רינדור בלבד.

import {
  interpolatedTexts,
  interpolationRefs,
  mapInterpolatedTexts,
} from '../engine/conditions';
import { screenConditions } from '../engine/validate';
import type { Condition, Screen, SurveyConfig, VarMeta } from '../engine/types';

/** ערך בהגרלה: מספר נשמר כמספר, כדי שתנאי מספרי ימשיך להשוות מספרים. */
export type RandomValue = string | number;

/** היכן משתנה עדיין בשימוש — מה בדיוק תשבור מחיקה שלו. */
export interface VarReference {
  screenId: string;
  /** 'condition' — showIf / כלל ניתוב / כלל סימון; 'text' — שיבוץ ‎{name}‎ בנוסח */
  kind: 'condition' | 'text';
}

/**
 * ‎"79"‎ → 79, כל השאר נשאר טקסט. ההגרלה מזינה תנאים, ומחיר ששמור כמחרוזת
 * לעולם לא יעבור תנאי "גדול מ־100" — בלי שום סימן לכך בקונסולה.
 */
export function parseRandomValue(raw: string): RandomValue {
  const trimmed = raw.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** סימון חדש נרשם ברמת השאלון (varMeta), כדי שכל מסך יראה אותו בשמו. */
export function defineVar(config: SurveyConfig, name: string, label: string): SurveyConfig {
  return {
    ...config,
    varMeta: { ...config.varMeta, [name]: { ...config.varMeta?.[name], label } },
  };
}

export function defineVarValue(
  config: SurveyConfig,
  name: string,
  value: string,
  label: string,
): SurveyConfig {
  const existing = config.varMeta?.[name];
  return {
    ...config,
    varMeta: {
      ...config.varMeta,
      [name]: {
        label: existing?.label ?? name,
        values: { ...existing?.values, [value]: label },
      },
    },
  };
}

/**
 * תווית ריקה נמחקת ולא נשמרת כמחרוזת ריקה: varValueLabel נופל למזהה רק כשאין
 * תווית כלל, ולכן תווית ריקה שמורה הייתה מציגה את הערך כשורה ריקה בכל מקום
 * שבו הקונסולה מזכירה אותו.
 */
export function setVarValueLabel(
  config: SurveyConfig,
  name: string,
  value: string,
  label: string,
): SurveyConfig {
  if (label.trim()) return defineVarValue(config, name, value, label);
  return moveValueLabel(config, name, value, null);
}

/**
 * הגרלה חדשה נולדת עם שתי משבצות ריקות ולא עם רשימה ריקה: שניים הם המינימום
 * שבלעדיו אין הגרלה, ושתי שורות שממתינות להקלדה מסבירות את זה טוב יותר
 * מכפתור "הוספת ערך" שעומד ליד שגיאה שאומרת שחסרים שניים.
 */
export function addRandomVar(config: SurveyConfig, name: string, label: string): SurveyConfig {
  return defineVar({ ...config, randomVars: { ...config.randomVars, [name]: ['', ''] } }, name, label);
}

function withValues(config: SurveyConfig, name: string, values: RandomValue[]): SurveyConfig {
  return { ...config, randomVars: { ...config.randomVars, [name]: values } };
}

export function addRandomValue(config: SurveyConfig, name: string): SurveyConfig {
  return withValues(config, name, [...(config.randomVars?.[name] ?? []), '']);
}

/**
 * עריכת ערך במקום גוררת איתו את התווית שלו. התווית ממופתחת לפי הערך, ולכן
 * השארתה מאחור לא רק מאבדת את השם שהאדמין הרגע כתב — היא מדביקה אותו לערך
 * הבא שיוקלד באותו מקום.
 */
export function setRandomValueAt(
  config: SurveyConfig,
  name: string,
  index: number,
  value: RandomValue,
): SurveyConfig {
  const values = [...(config.randomVars?.[name] ?? [])];
  if (index < 0 || index >= values.length) return config;
  const previous = String(values[index]);
  values[index] = value;
  const next = withValues(config, name, values);
  return moveValueLabel(next, name, previous, String(value));
}

export function removeRandomValueAt(config: SurveyConfig, name: string, index: number): SurveyConfig {
  const values = [...(config.randomVars?.[name] ?? [])];
  if (index < 0 || index >= values.length) return config;
  const [dropped] = values.splice(index, 1);
  const next = withValues(config, name, values);
  // התווית נמחקת רק כשאף ערך אחר לא נושא את אותו הערך (רשימה עם כפילות)
  if (values.some((v) => String(v) === String(dropped))) return next;
  return moveValueLabel(next, name, String(dropped), null);
}

/** מעביר תווית של ערך ממפתח למפתח; יעד null מוחק אותה. */
function moveValueLabel(
  config: SurveyConfig,
  name: string,
  from: string,
  to: string | null,
): SurveyConfig {
  const meta = config.varMeta?.[name];
  if (!meta?.values || !(from in meta.values) || from === to) return config;
  const values: Record<string, string> = {};
  for (const [key, label] of Object.entries(meta.values)) {
    if (key === from) {
      if (to !== null) values[to] = label;
    } else {
      values[key] = label;
    }
  }
  return { ...config, varMeta: { ...config.varMeta, [name]: { ...meta, values } } };
}

/**
 * מחיקת הגרלה מוחקת גם את התוויות שלה. תווית יתומה לא מזיקה למנוע, אבל היא כן
 * חוזרת: הקוד הבא שייווצר באותו שם יירש שם תצוגה של משהו אחר לגמרי.
 */
export function removeRandomVar(config: SurveyConfig, name: string): SurveyConfig {
  const { [name]: _values, ...randomVars } = config.randomVars ?? {};
  const { [name]: _meta, ...varMeta } = config.varMeta ?? {};
  const next: SurveyConfig = { ...config };
  if (Object.keys(randomVars).length > 0) next.randomVars = randomVars;
  else delete next.randomVars;
  if (Object.keys(varMeta).length > 0) next.varMeta = varMeta;
  else delete next.varMeta;
  return next;
}

/** סימון עם כל הערכים שידועים לו — הבסיס לעריכת מכסות. */
export interface Mark {
  name: string;
  /** מ-varMeta קודם (שם הסדר שהאדמין קבע), ואחריו ערכים שרק כללי onSubmit מכירים */
  values: string[];
}

/**
 * הסימונים שהמסכים קובעים — להבדיל מהגרלות (שנקבעות בכניסה) ומפרמטרי URL.
 * הערכים נאספים משני מקורות בכוונה: varMeta מחזיק את מה שהוגדר בקונסולה,
 * אבל קונפיג שנכתב ביד יכול לקבוע ערך שמעולם לא קיבל תווית — ומכסה שאי אפשר
 * להגדיר לו היא בדיוק המקרה שבו האדמין יחשוב שהמכסה קיימת.
 */
export function marks(config: SurveyConfig): Mark[] {
  const drawn = new Set(Object.keys(config.randomVars ?? {}));
  const found = new Map<string, string[]>();

  const add = (name: string, value?: string) => {
    if (drawn.has(name) || name.startsWith('url_')) return;
    const values = found.get(name) ?? [];
    if (value !== undefined && !values.includes(value)) values.push(value);
    found.set(name, values);
  };

  for (const [name, meta] of Object.entries(config.varMeta ?? {})) {
    add(name);
    for (const value of Object.keys(meta.values ?? {})) add(name, value);
  }
  for (const screen of config.screens) {
    for (const rule of screen.onSubmit ?? []) add(rule.var, String(rule.value));
  }
  return [...found].map(([name, values]) => ({ name, values }));
}

/**
 * מכסה ריקה נמחקת ולא נשמרת כ-0: היעדר רשומה הוא "בלי הגבלה", וכל מספר במפה
 * הוא מכסה אמיתית — כולל 0, שמשמעותו תא שנסגר ולא מקבל עוד משיבים.
 */
export function setQuota(
  config: SurveyConfig,
  name: string,
  value: string,
  limit: number | undefined,
): SurveyConfig {
  const meta = config.varMeta?.[name];
  const quotas = { ...meta?.quotas };
  if (limit === undefined) delete quotas[value];
  else quotas[value] = limit;

  const { quotas: _dropped, ...rest } = { ...meta, label: meta?.label ?? name };
  const next: VarMeta =
    Object.keys(quotas).length > 0 ? { ...rest, quotas } : rest;
  return { ...config, varMeta: { ...config.varMeta, [name]: next } };
}

/* ---------- שינוי קוד ---------- */
//
// קוד נעול אחרי הפרסום הראשון, אבל עד אליו הוא פתוח — ואז שינוי שלו חייב
// לגרור *כל* הפניה אליו בבת אחת. קוד שהשתנה במקום אחד ולא באחר משאיר שאלון
// שנראה תקין ומתנהג אחרת: תנאי שמפסיק להתקיים, מכסה שמפסיקה להיספר, שיבוץ
// שמדפיס סוגריים. לכן הכל יושב בפונקציה אחת, ולא באוסף עריכות שהקורא מרכיב.

/** מחליף מפתח במפה בלי לשנות את סדר המפתחות (הסדר הוא מה שהאדמין רואה). */
function renameKey<T>(
  map: Record<string, T> | undefined,
  from: string,
  to: string,
): Record<string, T> | undefined {
  if (!map || !(from in map)) return map;
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) out[key === from ? to : key] = value;
  return out;
}

/** מחיל טרנספורמציה על כל התנאים של המסך — showIf, כללי ניתוב וכללי סימון. */
function mapScreenConditions(screen: Screen, fn: (cond: Condition) => Condition): Screen {
  const next: Screen = { ...screen };
  if (next.showIf) next.showIf = fn(next.showIf);
  if (next.next) next.next = next.next.map((r) => (r.if ? { ...r, if: fn(r.if) } : r));
  if (next.onSubmit) next.onSubmit = next.onSubmit.map((r) => (r.if ? { ...r, if: fn(r.if) } : r));
  return next;
}

function mapLeaves(cond: Condition, fn: (leaf: Condition) => Condition): Condition {
  if ('all' in cond) return { all: cond.all.map((c) => mapLeaves(c, fn)) };
  if ('any' in cond) return { any: cond.any.map((c) => mapLeaves(c, fn)) };
  if ('not' in cond) return { not: mapLeaves(cond.not, fn) };
  return fn(cond);
}

/**
 * שינוי הקוד של סימון או הגרלה, על כל ההפניות אליו: כללי סימון, תנאים,
 * תוויות, מכסות, רשימת ההגרלה ושיבוץ ‎{name}‎ בנוסח המסכים.
 *
 * ⚠ מניח שהקוד החדש פנוי — הבדיקה נעשית בטופס (DefineForm.takenCodes), כי שם
 * אפשר להסביר לאדמין מה לא בסדר לפני שהוא לוחץ.
 */
export function renameVar(config: SurveyConfig, from: string, to: string): SurveyConfig {
  if (from === to) return config;

  const screens = config.screens.map((screen) => {
    let next = mapScreenConditions(screen, (cond) =>
      mapLeaves(cond, (leaf) => ('var' in leaf && leaf.var === from ? { ...leaf, var: to } : leaf)),
    );
    if (next.onSubmit?.some((r) => r.var === from)) {
      next = { ...next, onSubmit: next.onSubmit.map((r) => (r.var === from ? { ...r, var: to } : r)) };
    }
    // split/join ולא regex: הקוד מגיע מטופס ולא מהקוד שלנו, ואין סיבה להעביר
    // אותו דרך מנוע שמפרש תווים
    return mapInterpolatedTexts(next, (text) => text.split(`{${from}}`).join(`{${to}}`));
  });

  const next: SurveyConfig = { ...config, screens };
  const varMeta = renameKey(config.varMeta, from, to);
  const randomVars = renameKey(config.randomVars, from, to);
  if (varMeta) next.varMeta = varMeta;
  if (randomVars) next.randomVars = randomVars;
  return next;
}

/**
 * שינוי הקוד של *ערך* של סימון, על כל ההפניות אליו: הערך בכללי הסימון,
 * הערכים בתנאים (כולל בתוך רשימות של "אחד מאלה"), התווית והמכסה.
 *
 * ההשוואה נעשית על String(value) כי ערך יכול להיות שמור כמספר (הגרלה) בעוד
 * הקוד שהטופס מחזיר הוא תמיד מחרוזת.
 */
export function renameVarValue(
  config: SurveyConfig,
  mark: string,
  from: string,
  to: string,
): SurveyConfig {
  if (from === to) return config;
  const swap = (value: unknown) => (String(value) === from ? to : value);

  const screens = config.screens.map((screen) => {
    let next = mapScreenConditions(screen, (cond) =>
      mapLeaves(cond, (leaf) => {
        if (!('var' in leaf) || leaf.var !== mark || leaf.value === undefined) return leaf;
        return Array.isArray(leaf.value)
          ? { ...leaf, value: leaf.value.map(swap) }
          : { ...leaf, value: swap(leaf.value) };
      }),
    );
    if (next.onSubmit?.some((r) => r.var === mark && String(r.value) === from)) {
      next = {
        ...next,
        onSubmit: next.onSubmit.map((r) =>
          r.var === mark && String(r.value) === from ? { ...r, value: to } : r,
        ),
      };
    }
    return next;
  });

  const meta = config.varMeta?.[mark];
  const nextConfig: SurveyConfig = { ...config, screens };
  if (meta) {
    const values = renameKey(meta.values, from, to);
    const quotas = renameKey(meta.quotas, from, to);
    nextConfig.varMeta = {
      ...config.varMeta,
      [mark]: { ...meta, ...(values && { values }), ...(quotas && { quotas }) },
    };
  }
  const drawn = config.randomVars?.[mark];
  if (drawn) {
    nextConfig.randomVars = {
      ...config.randomVars,
      [mark]: drawn.map((v) => (String(v) === from ? parseRandomValue(to) : v)),
    };
  }
  return nextConfig;
}

function conditionUsesVar(cond: Condition, name: string): boolean {
  if ('all' in cond) return cond.all.some((c) => conditionUsesVar(c, name));
  if ('any' in cond) return cond.any.some((c) => conditionUsesVar(c, name));
  if ('not' in cond) return conditionUsesVar(cond.not, name);
  return 'var' in cond && cond.var === name;
}

/**
 * כל מה שיישבר אם המשתנה ייעלם. הוולידציה תתפוס את זה גם אחרי המחיקה (הפניה
 * לא קיימת, שיבוץ שלא ייפתר) — אבל אז השאלון כבר שבור, והאדמין צריך להבין
 * מה הוא עומד לעשות *לפני* שהוא לוחץ.
 */
export function varReferences(config: SurveyConfig, name: string): VarReference[] {
  const refs: VarReference[] = [];
  for (const screen of config.screens) {
    if (screenConditions(screen).some((c) => conditionUsesVar(c, name))) {
      refs.push({ screenId: screen.id, kind: 'condition' });
    }
    const inText = interpolatedTexts(screen).some(
      (text) => typeof text === 'string' && interpolationRefs(text).includes(name),
    );
    if (inText) refs.push({ screenId: screen.id, kind: 'text' });
  }
  return refs;
}
