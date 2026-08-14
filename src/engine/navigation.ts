// Pure navigation logic: given the current screen and the session context,
// decide which screen comes next. Extracted from App.tsx so it can be unit-tested
// and reused by the admin console (e.g. path preview).

import { evaluate } from './conditions';
import { hitsFullQuota, quotaFullScreen } from './quota';
import type { Screen, SurveyConfig, SurveyContext } from './types';

/**
 * ניתוב: קודם כללי next מפורשים (הראשון שתנאו מתקיים), אחרת סריקה קדימה
 * בסדר המערך אל המסך הראשון שעובר showIf. null = אין מסך הבא.
 *
 * מכסה מלאה נכנסת כאן ולא ככלל ניתוב שהאדמין כותב: היא חלה על *כל* מסך
 * שמסמן ערך שהתמלא, וכתיבה ידנית שלה בכל מסך כזה הייתה עבודה שחוזרת על עצמה
 * וגם נשכחת בדיוק במסך אחד. בלי מסך סיום מסוג quotafull אין לאן לנתב, והמנוע
 * ממשיך כרגיל — הוולידציה היא זו שמתריעה על ההגדרה החסרה.
 */
export function findNext(config: SurveyConfig, from: Screen, ctx: SurveyContext): Screen | null {
  const quotaFull = () => (hitsFullQuota(from, ctx) ? quotaFullScreen(config) : null);

  for (const rule of from.next ?? []) {
    if (!rule.if || evaluate(rule.if, ctx)) {
      const target = config.screens.find((s) => s.id === rule.goto) ?? null;
      // סינון מפורש גובר על מכסה מלאה: "לא מתאים למחקר" הוא אמירה חזקה יותר
      // מ"כבר יש לנו מספיק כאלה", ובניתוח השניים נספרים אחרת לגמרי.
      if (target?.type === 'end' && target.variant === 'screenout') return target;
      return quotaFull() ?? target;
    }
  }

  const full = quotaFull();
  if (full) return full;

  const idx = config.screens.findIndex((s) => s.id === from.id);
  for (let i = idx + 1; i < config.screens.length; i++) {
    const candidate = config.screens[i];
    if (!candidate.showIf || evaluate(candidate.showIf, ctx)) return candidate;
  }
  return null;
}
