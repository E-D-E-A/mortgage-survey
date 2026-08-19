// Fixture configs for the MCP suite. Hebrew wording on purpose — the round-trip
// tests must push real content, including quotes and newlines, through the
// whole propose→apply pipe and get the identical bytes back.

import type { SurveyConfig } from '../../src/engine/types';

/** A small, valid survey: intro → status question → end. */
export function baseConfig(): SurveyConfig {
  return {
    version: 'draft',
    screens: [
      {
        id: 'intro',
        type: 'info',
        title: 'שאלון משכנתאות',
        body: 'כמה שאלות קצרות על התוכניות שלכם.\nתודה שאתם כאן!',
        cta: 'מתחילים',
      },
      {
        id: 's_status',
        type: 'single',
        prompt: 'מה מתאר אתכם הכי טוב?',
        options: [
          { id: 'young_couple', label: 'זוג צעיר לקראת דירה ראשונה' },
          { id: 'homeowner', label: 'בעלי דירה עם משכנתה' },
          { id: 'other', label: 'אחר' },
        ],
      },
      {
        id: 'end_complete',
        type: 'end',
        variant: 'complete',
        title: 'תודה רבה!',
        body: 'התשובות נשמרו.',
      },
    ],
  };
}

/**
 * The golden task's target: the base survey after a scripted "add a persona
 * branch + an A/B price draw + a quota" change. Written out in full, as its own
 * literal — the test asserts the applied draft equals exactly this, so any
 * layer that silently drops or rewrites a field (schema stripping, a diff
 * "fixing" something) breaks the comparison.
 */
export function goldenConfig(): SurveyConfig {
  return {
    version: 'draft',
    randomVars: {
      price: [79, 149, 249],
    },
    varMeta: {
      price: { label: 'מחיר לניסוי' },
      persona: {
        label: 'פרסונה',
        values: {
          young_couple: 'זוג צעיר',
          other: 'כל השאר',
        },
        quotas: { young_couple: 50 },
      },
    },
    screens: [
      {
        id: 'intro',
        type: 'info',
        title: 'שאלון משכנתאות',
        body: 'כמה שאלות קצרות על התוכניות שלכם.\nתודה שאתם כאן!',
        cta: 'מתחילים',
      },
      {
        id: 's_status',
        type: 'single',
        prompt: 'מה מתאר אתכם הכי טוב?',
        options: [
          { id: 'young_couple', label: 'זוג צעיר לקראת דירה ראשונה' },
          { id: 'homeowner', label: 'בעלי דירה עם משכנתה' },
          { id: 'other', label: 'אחר' },
        ],
        onSubmit: [
          {
            var: 'persona',
            value: 'young_couple',
            if: { q: 's_status', op: 'eq', value: 'young_couple' },
          },
          {
            var: 'persona',
            value: 'other',
            if: { not: { q: 's_status', op: 'eq', value: 'young_couple' } },
          },
        ],
      },
      {
        id: 's_partner_plans',
        type: 'single',
        prompt: 'האם "התוכנית" שלכם כוללת רכישה בשנה הקרובה?\n(גם אם עדיין לא התחלתם לחפש)',
        showIf: { var: 'persona', op: 'eq', value: 'young_couple' },
        options: [
          { id: 'this_year', label: 'כן, בשנה הקרובה' },
          { id: 'later', label: 'בהמשך' },
        ],
      },
      {
        id: 's_price',
        type: 'single',
        prompt: 'האם הייתם משלמים {price} ש״ח בחודש על ליווי מקצועי?',
        options: [
          { id: 'yes', label: 'כן' },
          { id: 'no', label: 'לא' },
        ],
      },
      {
        id: 'end_complete',
        type: 'end',
        variant: 'complete',
        title: 'תודה רבה!',
        body: 'התשובות נשמרו.',
      },
      {
        id: 'end_quotafull',
        type: 'end',
        variant: 'quotafull',
        title: 'כבר נאספו מספיק משיבים כאלה',
        body: 'תודה על הנכונות — המכסה לקבוצה הזאת התמלאה.',
      },
    ],
  };
}
