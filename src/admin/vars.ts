// עריכות ברמת השאלון על משתני הסשן, כפונקציות טהורות: הגדרת סימון, הגדרת ערך,
// יצירה ומחיקה של הגרלה, ועריכת רשימת הערכים שלה — וגם איתור כל מה שעדיין
// מפנה למשתנה, לפני שמוחקים אותו.
//
// טהורות ובלי React, מאותה סיבה שבגללה edits.ts קיים: זו הלוגיקה שאפשר וצריך
// לבדוק ביחידה, והרכיב שמעליה נשאר רינדור בלבד.

import { interpolatedTexts, interpolationRefs } from '../engine/conditions';
import { screenConditions } from '../engine/validate';
import type { Condition, SurveyConfig } from '../engine/types';

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
