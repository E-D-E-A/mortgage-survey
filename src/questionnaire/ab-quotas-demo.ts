// A worked example of the two newest mechanisms, as a complete, publishable
// questionnaire: an A/B draw (ENG-19) and persona quotas (ENG-20/21).
//
// It exists because both features are only convincing end to end. A price that
// varies per respondent is a config field until you see it inside the question
// text; a quota is a number until a respondent is actually turned away by it.
// This config produces both, and validateConfig proves it clean on every test
// run (ab-quotas-demo.test.ts) — so the example can never quietly rot into
// something that would not publish.
//
// What it demonstrates, and where to look:
//
//   randomVars.price   — drawn once on entry, interpolated into ab_price's
//                        wording as {price}. The classic willingness-to-pay A/B.
//   randomVars.pitch   — a draw used the other way: as a condition. Two framings
//                        of the same follow-up, one shown per arm, so the arm
//                        drives routing rather than text.
//   varMeta.persona    — three personas, assigned totally on one screen (the
//                        unconditional rule comes first and the specific ones
//                        overwrite it, so going back and changing the answer can
//                        never leave the previous persona behind).
//   quotas             — 50 young couples, 40 owners, browsers uncapped. Once a
//                        cell fills, the engine sends that respondent to
//                        end_quotafull straight after s_status, with no routing
//                        rule written anywhere.
//
// The wording is deliberately plain: this is a demonstration of the machinery,
// not a research instrument. The real questionnaire is survey-v1.ts.

import type { SurveyConfig } from '../engine/types';

export const abQuotasDemo: SurveyConfig = {
  version: 'ab-quotas-demo',

  // Both draws happen once, before the first screen, and stay fixed for the
  // session — so a respondent who goes back never sees a different price.
  randomVars: {
    price: [79, 149, 249],
    pitch: ['saving', 'speed'],
  },

  varMeta: {
    persona: {
      label: 'פרסונה',
      values: {
        young_couple: 'זוג צעיר לפני רכישה',
        owner: 'בעל/ת משכנתה קיימת',
        browsing: 'מתעניין/ת בלבד',
      },
      // The two cells the study is actually buying. `browsing` has no entry, so
      // it is uncapped — absence means unlimited, and 0 would mean closed.
      quotas: {
        young_couple: 50,
        owner: 40,
      },
    },
    price: { label: 'מחיר שהוצג (ניסוי)' },
    pitch: {
      label: 'נוסח ההצגה (ניסוי)',
      values: { saving: 'חיסכון בכסף', speed: 'חיסכון בזמן' },
    },
  },

  screens: [
    {
      id: 'intro',
      type: 'info',
      title: 'כמה שאלות על משכנתה',
      body: 'השאלון קצר, אנונימי ולוקח כשתי דקות. אין תשובות נכונות או שגויות — מעניין אותנו רק המצב שלכם.',
      cta: 'מתחילים',
    },
    {
      id: 'consent',
      type: 'consent',
      title: 'הסכמה להשתתפות',
      body: 'ההשתתפות מרצון ואפשר להפסיק בכל שלב. לא נבקש פרטים מזהים, והתשובות משמשות למחקר מוצר בלבד.',
      agreeLabel: 'אני מסכים/ה',
      declineLabel: 'לא מעוניין/ת',
      next: [{ if: { q: 'consent', op: 'eq', value: 'declined' }, goto: 'end_screenout' }],
    },
    {
      id: 's_age',
      type: 'number',
      prompt: 'מה גילך?',
      min: 16,
      max: 120,
      integer: true,
      next: [{ if: { q: 's_age', op: 'lt', value: 18 }, goto: 'end_screenout' }],
    },
    {
      id: 's_status',
      type: 'single',
      prompt: 'מה מתאר את מצבך היום?',
      options: [
        { id: 'planning', label: 'מתכנן/ת לקחת משכנתה בשנה הקרובה' },
        { id: 'active', label: 'יש לי משכנתה קיימת' },
        { id: 'browsing', label: 'רק מתעניין/ת, בלי תוכנית ממשית' },
      ],
      // ⚠ The unconditional rule comes first on purpose: later rules overwrite
      // earlier ones, so this is the default that the two specific answers
      // replace. It is also what makes the assignment total — a respondent who
      // goes back and changes their answer always gets a freshly computed
      // persona instead of keeping the old one.
      //
      // This is the screen the quota fires on: the moment it assigns a persona
      // whose cell is full, findNext sends the respondent to end_quotafull.
      onSubmit: [
        { var: 'persona', value: 'browsing' },
        { var: 'persona', value: 'young_couple', if: { q: 's_status', op: 'eq', value: 'planning' } },
        { var: 'persona', value: 'owner', if: { q: 's_status', op: 'eq', value: 'active' } },
      ],
    },
    {
      id: 'c_timeline',
      type: 'single',
      showIf: { var: 'persona', op: 'eq', value: 'young_couple' },
      prompt: 'מתי לדעתך תגישו בקשה למשכנתה?',
      options: [
        { id: 'm0_3', label: 'בתוך שלושה חודשים' },
        { id: 'm4_12', label: 'בתוך שנה' },
        { id: 'later', label: 'מאוחר יותר' },
        { id: 'unknown', label: 'לא יודע/ת' },
      ],
    },
    {
      id: 'o_pain',
      type: 'matrix',
      showIf: { var: 'persona', op: 'eq', value: 'owner' },
      prompt: 'עד כמה היה קשה לכם כל אחד מהשלבים האלה?',
      items: [
        { id: 'compare', label: 'להשוות בין הצעות של בנקים' },
        { id: 'total_cost', label: 'להבין את העלות הכוללת' },
        { id: 'paperwork', label: 'לאסוף את המסמכים' },
      ],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'קל מאוד',
      maxLabel: 'קשה מאוד',
      naLabel: 'לא רלוונטי',
      shuffleItems: true,
    },
    {
      // The A/B itself: {price} is replaced with this respondent's drawn value.
      // Everyone reaches this screen — the draw, not the persona, is what varies.
      id: 'ab_price',
      type: 'single',
      prompt: 'שירות שמנהל עבורכם את כל תהליך המשכנתה מול הבנקים עולה {price} ש"ח. מה הייתם עושים?',
      help: 'אין כאן מכירה — רק מנסים להבין כמה זה שווה בעיניכם.',
      options: [
        { id: 'buy', label: 'קונה' },
        { id: 'consider', label: 'שוקל/ת, צריך/ה לבדוק' },
        { id: 'no', label: 'לא קונה' },
      ],
    },
    {
      // The same draw used as a condition rather than as text: each arm gets its
      // own follow-up, and the two screens share a lane in the console diagram.
      id: 'pitch_saving',
      type: 'text',
      showIf: { var: 'pitch', op: 'eq', value: 'saving' },
      prompt: 'אם השירות היה חוסך לכם כסף על המשכנתה — כמה חיסכון היה מצדיק את המחיר הזה?',
      optional: true,
      multiline: true,
      placeholder: 'אפשר לדלג',
    },
    {
      id: 'pitch_speed',
      type: 'text',
      showIf: { var: 'pitch', op: 'eq', value: 'speed' },
      prompt: 'אם השירות היה חוסך לכם שבועות של התעסקות — כמה זמן היה מצדיק את המחיר הזה?',
      optional: true,
      multiline: true,
      placeholder: 'אפשר לדלג',
    },
    {
      id: 'd_region',
      type: 'single',
      prompt: 'באיזה אזור אתם מחפשים או גרים?',
      options: [
        { id: 'north', label: 'צפון' },
        { id: 'center', label: 'מרכז' },
        { id: 'south', label: 'דרום' },
        { id: 'jerusalem', label: 'ירושלים והסביבה' },
      ],
    },
    {
      id: 'end_complete',
      type: 'end',
      variant: 'complete',
      title: 'תודה רבה!',
      body: 'התשובות נקלטו. זה עוזר לנו מאוד.',
    },
    {
      id: 'end_screenout',
      type: 'end',
      variant: 'screenout',
      title: 'תודה על הזמן',
      body: 'השאלון הזה מיועד למצבים אחרים, ולכן נסיים כאן.',
    },
    {
      // Nothing routes here in the config — the engine does, the moment a
      // respondent is marked with a persona whose quota has filled.
      id: 'end_quotafull',
      type: 'end',
      variant: 'quotafull',
      title: 'תודה, כבר סיימנו לאסוף',
      body: 'כבר אספנו מספיק תשובות ממשיבים במצב שלכם. תודה על הנכונות!',
    },
  ],
};
