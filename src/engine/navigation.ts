// Pure navigation logic: given the current screen and the session context,
// decide which screen comes next. Extracted from App.tsx so it can be unit-tested
// and reused by the admin console (e.g. path preview).

import { evaluate } from './conditions';
import type { Screen, SurveyConfig, SurveyContext } from './types';

/**
 * ניתוב: קודם כללי next מפורשים (הראשון שתנאו מתקיים), אחרת סריקה קדימה
 * בסדר המערך אל המסך הראשון שעובר showIf. null = אין מסך הבא.
 */
export function findNext(config: SurveyConfig, from: Screen, ctx: SurveyContext): Screen | null {
  for (const rule of from.next ?? []) {
    if (!rule.if || evaluate(rule.if, ctx)) {
      return config.screens.find((s) => s.id === rule.goto) ?? null;
    }
  }
  const idx = config.screens.findIndex((s) => s.id === from.id);
  for (let i = idx + 1; i < config.screens.length; i++) {
    const candidate = config.screens[i];
    if (!candidate.showIf || evaluate(candidate.showIf, ctx)) return candidate;
  }
  return null;
}
