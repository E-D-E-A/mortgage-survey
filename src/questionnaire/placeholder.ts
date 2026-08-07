import type { Condition, SurveyConfig } from '../engine/types';

// ⚠️ שאלון הדגמה לבדיקת התשתית בלבד — לא הנוסח הסופי.
// הוא מפעיל בכוונה את כל המנגנונים שהשלד המחקרי דורש:
//   - סינון עם ניתוב (גיל < 18 → סיום מוקדם)
//   - תנאי משולב לקביעת מקטע B (צפי ≤ 12 חודשים וגם פעולה ממשית)
//   - הקצאה אקראית של מחיר (ניסוי B39) עם שיבוץ בנוסח השאלה
//   - ערבוב סדר פריטים במטריצה
//   - אפשרות בלעדית ("לא ביצעתי אף פעולה") ברב-ברירה
// השאלון הסופי ייכתב בקובץ נפרד באותו פורמט, אחרי תהליך הזיקוק.

const REAL_ACTIONS = ['budget', 'bank', 'advisor', 'approval'];

const segmentBRule: Condition = {
  all: [
    { q: 's_timeline', op: 'in', value: ['m0_3', 'm4_6', 'm7_12'] },
    { q: 's_actions', op: 'includesAny', value: REAL_ACTIONS },
  ],
};

export const questionnaire: SurveyConfig = {
  version: 'infra-demo-1',
  randomVars: {
    price: [79, 149, 249],
  },
  screens: [
    {
      id: 'intro',
      type: 'info',
      title: 'שאלון הדגמה — בדיקת תשתית',
      body: 'זהו שאלון דמו שנועד לוודא שהמערכת עובדת מקצה לקצה: ניתוב, הקצאה אקראית, שמירת תשובות ומדידת זמנים.\n\nהנוסח הסופי ייבנה בתהליך הזיקוק.',
      cta: 'להתחיל',
    },
    {
      id: 'consent',
      type: 'consent',
      title: 'הסכמה להשתתפות',
      body: 'ההשתתפות מרצון וניתן להפסיק בכל שלב. לא נבקש פרטים מזהים. התשובות ישמשו למחקר מוצר בלבד.',
      agreeLabel: 'אני מסכים/ה להשתתף',
      declineLabel: 'לא מעוניין/ת',
      next: [{ if: { q: 'consent', op: 'eq', value: 'declined' }, goto: 'end_screenout' }],
    },
    {
      id: 's_age',
      type: 'number',
      prompt: 'מה גילך?',
      min: 16,
      max: 120,
      next: [{ if: { q: 's_age', op: 'lt', value: 18 }, goto: 'end_screenout' }],
    },
    {
      id: 's_mortgage',
      type: 'single',
      prompt: 'האם קיימת כיום משכנתה על דירה או נכס שבבעלותך או בבעלות משק הבית שלך?',
      options: [
        { id: 'yes', label: 'כן' },
        { id: 'no', label: 'לא' },
        { id: 'dontknow', label: 'לא יודע/ת' },
      ],
      onSubmit: [{ var: 'segment', value: 'A', if: { q: 's_mortgage', op: 'eq', value: 'yes' } }],
    },
    {
      id: 's_timeline',
      type: 'single',
      showIf: { q: 's_mortgage', op: 'ne', value: 'yes' },
      prompt: 'מתי, להערכתך, תבקש/י משכנתה לצורך רכישה או בנייה?',
      options: [
        { id: 'm0_3', label: 'בתוך 0–3 חודשים' },
        { id: 'm4_6', label: 'בתוך 4–6 חודשים' },
        { id: 'm7_12', label: 'בתוך 7–12 חודשים' },
        { id: 'm13_24', label: 'בעוד שנה עד שנתיים' },
        { id: 'later', label: 'בעוד יותר משנתיים' },
        { id: 'unknown', label: 'לא יודע/ת' },
        { id: 'never', label: 'לא מתכנן/ת' },
      ],
    },
    {
      id: 's_actions',
      type: 'multi',
      showIf: { q: 's_mortgage', op: 'ne', value: 'yes' },
      prompt: 'אילו מהפעולות הבאות ביצעת ב-90 הימים האחרונים?',
      options: [
        { id: 'budget', label: 'חישוב תקציב או בירור הון עצמי' },
        { id: 'bank', label: 'פגישה או שיחה עם בנק' },
        { id: 'advisor', label: 'פנייה ליועץ משכנתאות' },
        { id: 'approval', label: 'בקשת אישור עקרוני' },
        { id: 'search', label: 'חיפוש נכס פעיל' },
        { id: 'none', label: 'לא ביצעתי אף אחת מהפעולות', exclusive: true },
      ],
      onSubmit: [
        { var: 'segment', value: 'B', if: segmentBRule },
        { var: 'segment', value: 'C', if: { not: segmentBRule } },
      ],
    },
    {
      id: 'a_difficulty',
      type: 'matrix',
      showIf: { var: 'segment', op: 'eq', value: 'A' },
      prompt: 'עד כמה היה לך קשה לבצע כל אחת מהפעולות הבאות?',
      items: [
        { id: 'understand_tracks', label: 'להבין את המסלולים שמהם מורכבת המשכנתה' },
        { id: 'compare', label: 'להשוות בין חלופות' },
        { id: 'total_cost', label: 'להבין את העלות הכוללת' },
      ],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'קל מאוד',
      maxLabel: 'קשה מאוד',
      naLabel: 'לא רלוונטי',
      shuffleItems: true,
    },
    {
      id: 'b_price',
      type: 'single',
      showIf: { var: 'segment', op: 'eq', value: 'B' },
      prompt: 'אם שירות שעוזר להשוות הצעות משכנתה היה עולה {price} ש"ח, מה היית עושה?',
      options: [
        { id: 'buy', label: 'קונה' },
        { id: 'check_alt', label: 'בודק/ת חלופה אחרת' },
        { id: 'no', label: 'לא קונה' },
        { id: 'dontknow', label: 'לא יודע/ת' },
      ],
    },
    {
      id: 'c_open',
      type: 'text',
      showIf: { var: 'segment', op: 'eq', value: 'C' },
      prompt: 'ספר/י על הפעם האחרונה שבה חשבת ברצינות על רכישת דירה. מה עורר את המחשבה?',
      multiline: true,
      optional: true,
      placeholder: 'אפשר לדלג אם אין לך דוגמה',
    },
    {
      id: 'end_complete',
      type: 'end',
      variant: 'complete',
      title: 'תודה רבה!',
      body: 'התשובות נשמרו. תרומתך חשובה לנו מאוד.',
    },
    {
      id: 'end_screenout',
      type: 'end',
      variant: 'screenout',
      title: 'תודה על ההתעניינות',
      body: 'השאלון אינו מיועד למצבך הנוכחי, ולכן נסיים כאן. תודה רבה!',
    },
  ],
};
