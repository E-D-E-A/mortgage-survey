// המסלול שמשיב עובר בפועל בקונטקסט נתון — הבסיס לשני דברים שהמערך המלא
// של המסכים לא יכול לתת: גיזום תשובות ממקטע נטוש, ופס התקדמות אמיתי.

import { evaluate } from './conditions';
import { findNext } from './navigation';
import type { Answers, Screen, SurveyConfig, SurveyContext, Vars } from './types';

/**
 * סימולציה של הניווט מהמסך הראשון עם הקונטקסט הנתון: מכבדת showIf, כללי
 * next/goto וסריקה קדימה — בדיוק כמו המשיב האמיתי.
 *
 * `seen` הוא הגנה מפני מעגלים: הוולידציה חוסמת אותם, אבל קונפיג שפורסם לפני
 * שהחסימה נוספה עלול להכיל אחד, ופונקציה טהורה לא אמורה להיתקע בלולאה.
 */
export function visitedPath(config: SurveyConfig, ctx: SurveyContext): Screen[] {
  const path: Screen[] = [];
  const seen = new Set<string>();
  let current: Screen | null = config.screens[0] ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    if (current.type === 'end') break;
    current = findNext(config, current, ctx);
  }
  return path;
}

export interface SimStep {
  screen: Screen;
  /** משתני הסשן אחרי ה-onSubmit של המסך הזה — מה שהמסכים הבאים יראו */
  vars: Vars;
}

/**
 * הרצה יבשה של השאלון על תשובות נתונות: כמו visitedPath, אבל גם מחילה את
 * כללי ה-onSubmit בדרך במקום לקבל את המשתנים מבחוץ.
 *
 * זה מה שמאפשר לקונסולה להראות מסלול אמיתי מתוך תשובות בלבד — בלי זה כל
 * מסך שתלוי ב-segment היה נופל, כי המשתנה נקבע רק תוך כדי המסע.
 * ⚠ הסדר בתוך onSubmit משמעותי: כלל רואה את מה שקדם לו, בדיוק כמו ב-App.
 */
export function simulatePath(config: SurveyConfig, answers: Answers, seed: Vars = {}): SimStep[] {
  const steps: SimStep[] = [];
  const seen = new Set<string>();
  const vars: Vars = { ...seed };
  const ctx: SurveyContext = { answers, vars };
  let current: Screen | null = config.screens[0] ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    for (const rule of current.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) vars[rule.var] = rule.value;
    }
    steps.push({ screen: current, vars: { ...vars } });
    if (current.type === 'end') break;
    current = findNext(config, current, ctx);
  }
  return steps;
}

/**
 * גיזום ה-payload הסופי. משיב שחזר אחורה ושינה תשובה שמנתבת (למשל s_actions
 * שמעביר אותו מ-B ל-C) משאיר מאחוריו תשובות של מסכים שכבר לא שייכים לו —
 * הן יושבות ב-state.answers ומזהמות כל ניתוח לפי מקטע.
 *
 * ⚠ הגיזום חל על ה-payload בלבד. state.answers נשאר שלם, כדי שחזרה אחורה
 * תמשיך להציג למשיב את מה שענה (ראו seeding ב-components/inputs.tsx).
 */
export function pruneAnswers(config: SurveyConfig, ctx: SurveyContext): Answers {
  const onPath = new Set(visitedPath(config, ctx).map((s) => s.id));
  const pruned: Answers = {};
  for (const [screenId, value] of Object.entries(ctx.answers)) {
    if (onPath.has(screenId)) pruned[screenId] = value;
  }
  return pruned;
}

/**
 * התקדמות (0..1) לפי המסלול הצפוי בקונטקסט הנוכחי ולא לפי המערך המלא —
 * אחרת משיב במקטע A "קופץ" עשרות אחוזים ברגע ששני המקטעים האחרים נופלים.
 *
 * ⚠ הערך אינו מונוטוני מעצמו: כל עוד segment טרם נקבע, כל מסכי A/B/C נופלים
 * והמסלול הצפוי קצר. הקורא אחראי להחזיק מקסימום רץ (ראו App.tsx) כדי שהפס
 * לעולם לא ייסוג.
 */
export function progressRatio(config: SurveyConfig, currentId: string, ctx: SurveyContext): number {
  const path = visitedPath(config, ctx);
  const index = path.findIndex((s) => s.id === currentId);
  const last = path.length - 1;
  if (index < 0 || last <= 0) return 0;
  return index / last;
}
