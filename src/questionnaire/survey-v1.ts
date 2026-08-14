import type { Condition, SurveyConfig } from '../engine/types';

// The persona validation survey — the lean version, capped at 15 questions per respondent.
//
// Derived from the research skeleton (Confluence MTG 13729793) through the refinement process documented in docs/:
//   distillation-plan.md · persona-mapping.md · question-triage.md · wording-v1.md
// The id → skeleton code → coding mapping, and the full list of what was cut: docs/codebook.md
//
// A fixed budget of 15 questions per respondent, spent differently per track — A
// respondents skip two screening questions (expectation, actions) and so get two
// content questions in their place:
//
//            screening  track  demographics  commitment  total
//   segment A      2        9          3           1         15
//   segment B      4        7          3           1         15
//   segment C      4        7          3           1         15
//
// ⚠ The full version (v1.0, 23–32 questions) is kept in the git history. The
//   "questions on hold" section of the codebook lists what was cut and in what
//   order to bring it back if budget frees up.
//
// ⚠ The segment invariant: onSubmit variables are not reset by backwards
//   navigation, so every screen that assigns segment does so with a complementary
//   pair of rules (a condition + not(condition)) — s_status assigns A or
//   'pending', and s_actions assigns B or C. That way going back and changing an
//   answer always overwrites the old value. s_timeline/s_actions' showIf leans on
//   the *answer* to s_status rather than on the variable, so any change routes
//   through a screen that recomputes it again.

/** Segment B = an expectation of ≤ 12 months *and* at least one real action in 90 days. */
const segmentBRule: Condition = {
  all: [
    { q: 's_timeline', op: 'in', value: ['m0_3', 'm4_6', 'm7_12'] },
    // The skeleton counts all seven actions as "real" — including property search, a lawyer/agent and preparing documents.
    {
      q: 's_actions',
      op: 'includesAny',
      value: ['budget', 'bank', 'advisor', 'approval', 'search', 'legal', 'docs'],
    },
  ],
};

/** Track A = an active mortgage, or involvement in one over the last five years. */
const statusIsA: Condition = { q: 's_status', op: 'in', value: ['active', 'past5'] };

const inA: Condition = { var: 'segment', op: 'eq', value: 'A' };
const inB: Condition = { var: 'segment', op: 'eq', value: 'B' };
const inC: Condition = { var: 'segment', op: 'eq', value: 'C' };

export const questionnaire: SurveyConfig = {
  version: 'v1.1',
  // Display only: the console shows these labels in place of segment / A / B / C.
  // The variable and value names themselves remain the analysis codes
  // (docs/codebook.md).
  // The labels deliberately omit the code letters: A/B/C are the analysis codes
  // (docs/codebook.md) and stay in the data file — on screen you read the
  // description alone.
  varMeta: {
    segment: {
      label: 'מסלול המשיב',
      values: {
        A: 'יש או הייתה משכנתה',
        B: 'לקראת משכנתה בשנה הקרובה',
        C: 'מוקדם מדי או לא רלוונטי',
        pending: 'טרם נקבע',
      },
    },
  },
  screens: [
    // ────────────── screening · A sees 2, B/C see 4 ──────────────
    {
      id: 'intro',
      type: 'info',
      title: 'אנחנו חוקרים איך אנשים בישראל מתמודדים עם משכנתה',
      body: 'מטרת המחקר היא להבין כיצד אנשים בישראל נערכים למשכנתה, מקבלים החלטות ומנהלים משכנתה קיימת.\n\nהמחקר נערך עבור E.D.E.A. הוא אינו מכירה ואינו ייעוץ פיננסי, משפטי או בנקאי, והשתתפותך לא תשפיע על זכאותך לאשראי או על תנאים שתקבל/י מגוף כלשהו.\n\nאין תשובות נכונות או שגויות — אנחנו רוצים להבין מה באמת קרה ומה באמת חשוב לך.\n\nמשך השאלון: כ-5 דקות.',
      cta: 'להתחיל',
    },
    {
      id: 'consent',
      type: 'consent',
      title: 'הסכמה להשתתפות',
      body: 'ההשתתפות מרצון. אפשר לדלג על כל שאלה או להפסיק בכל שלב, ללא כל השלכה.\n\nנאסוף את התשובות שתמסור/י וכן נתוני שימוש טכניים מינימליים, כגון זמן השלמה וסוג מכשיר. לא נבקש מספר תעודת זהות, מספר חשבון או סיסמת בנק.\n\nהנתונים יישמרו עד תום המחקר ולא יותר מ-36 חודשים, ישמשו למחקר ולפיתוח מוצר בלבד, ויהיו נגישים לצוות המחקר של E.D.E.A ולשותפים מקצועיים המחויבים לסודיות.\n\nאם תבחר/י להשאיר פרטי קשר בסוף השאלון — הם יישמרו בנפרד מהתשובות.',
      agreeLabel: 'אני מסכים/ה להשתתף',
      declineLabel: 'לא מעוניין/ת להשתתף',
      next: [{ if: { q: 'consent', op: 'eq', value: 'declined' }, goto: 'end_screenout' }],
    },
    {
      // 1 — doubles as the demographic age; not asked again.
      id: 's_age',
      type: 'number',
      prompt: 'מה גילך?',
      min: 16,
      max: 120,
      integer: true,
      next: [{ if: { q: 's_age', op: 'lt', value: 18 }, goto: 'end_screenout' }],
    },
    {
      // 2 — a merge of S4+S5; routes to A.
      id: 's_status',
      type: 'single',
      prompt: 'מה מתאר את מצבך בנוגע למשכנתה?',
      options: [
        {
          id: 'active',
          label: 'קיימת כיום משכנתה על דירה או נכס שבבעלותי או בבעלות משק הבית שלי',
        },
        {
          id: 'past5',
          label:
            'אין כיום משכנתה, אך הייתי מעורב/ת בנטילה, מִחזור או סגירה של משכנתה בחמש השנים האחרונות',
        },
        { id: 'none', label: 'אף אחד מהמצבים האלה' },
        { id: 'dontknow', label: 'לא יודע/ת' },
        // Restores S3's screening ("not involved in the decision") at the cost of
        // zero questions, after s_role was cut from the budget.
        { id: 'not_involved', label: 'איני מעורב/ת בהחלטות משכנתה של משק הבית שלי' },
      ],
      // 'pending' = not yet decided; no showIf compares against it, so no segment
      // screen opens by accident after going back and changing an answer.
      onSubmit: [
        { var: 'segment', value: 'A', if: statusIsA },
        { var: 'segment', value: 'pending', if: { not: statusIsA } },
      ],
      next: [{ if: { q: 's_status', op: 'eq', value: 'not_involved' }, goto: 'end_screenout' }],
    },
    {
      // 3 — B/C only
      id: 's_timeline',
      type: 'single',
      showIf: { q: 's_status', op: 'in', value: ['none', 'dontknow'] },
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
      // 4 — B/C only
      id: 's_actions',
      type: 'multi',
      showIf: { q: 's_status', op: 'in', value: ['none', 'dontknow'] },
      prompt: 'אילו מהפעולות הבאות ביצעת ב-90 הימים האחרונים?',
      options: [
        { id: 'budget', label: 'חישוב תקציב או בירור הון עצמי' },
        { id: 'bank', label: 'פגישה או שיחה עם בנק' },
        { id: 'advisor', label: 'פנייה ליועץ משכנתאות' },
        { id: 'approval', label: 'בקשת אישור עקרוני' },
        { id: 'search', label: 'חיפוש נכס פעיל' },
        { id: 'legal', label: 'שיחה עם עורך דין או מתווך' },
        { id: 'docs', label: 'הכנת מסמכים' },
        { id: 'none', label: 'לא ביצעתי אף אחת מהפעולות', exclusive: true },
      ],
      onSubmit: [
        { var: 'segment', value: 'B', if: segmentBRule },
        { var: 'segment', value: 'C', if: { not: segmentBRule } },
      ],
    },

    // ───────────────────────── track A · 9 questions ─────────────────────────
    {
      // BES-R — the behavioural anchor. Without it there is no telling an active need from curiosity.
      id: 'a_last_when',
      type: 'single',
      showIf: inA,
      prompt: 'מתי בפעם האחרונה בדקת את המשכנתה, דיברת עליה עם איש מקצוע, או שקלת לשנות אותה?',
      help: 'השאלות הבאות עוסקות במשכנתה האחרונה שבה היית מעורב/ת.',
      options: [
        { id: 'last_month', label: 'בחודש האחרון' },
        { id: 'm1_3', label: 'לפני 1–3 חודשים' },
        { id: 'm4_12', label: 'לפני 4–12 חודשים' },
        { id: 'over_year', label: 'לפני יותר משנה' },
        { id: 'never', label: 'לא עשיתי דבר מאלה' },
      ],
    },
    {
      // The pain measure — it carries the "pain worth an MVP" threshold (30% at severity 4–5).
      id: 'a_difficulty',
      type: 'matrix',
      showIf: inA,
      prompt: 'עד כמה היה לך קשה לבצע כל אחת מהפעולות הבאות?',
      items: [
        { id: 'tracks', label: 'להבין את המסלולים שמהם מורכבת המשכנתה' },
        { id: 'total_cost', label: 'להבין את העלות הכוללת' },
        { id: 'compare', label: 'להשוות בין חלופות' },
        { id: 'rate_change', label: 'להעריך כיצד שינוי בריבית או במדד ישפיע עליי' },
      ],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'קל מאוד',
      maxLabel: 'קשה מאוד',
      naLabel: 'לא רלוונטי',
      shuffleItems: true,
    },
    {
      // P4 (Adi and Yaron) + H3's outcome variable.
      id: 'a_refi',
      type: 'single',
      showIf: inA,
      prompt: 'האם שקלת מִחזור של המשכנתה בשנתיים האחרונות?',
      options: [
        { id: 'considered_done', label: 'כן, ואף ביצעתי' },
        { id: 'considered_not', label: 'כן, אך לא ביצעתי' },
        { id: 'no', label: 'לא שקלתי' },
        { id: 'dontknow', label: 'לא יודע/ת' },
      ],
    },
    {
      // The predictor in H3 (cash-flow pressure versus general information) + P10.
      id: 'a_cashflow',
      type: 'single',
      showIf: inA,
      prompt:
        'ב-12 החודשים האחרונים, באיזו תדירות שינית או צמצמת הוצאות אחרות כדי לעמוד בהחזר המשכנתה?',
      help: 'אנשים רבים נדרשים לצמצם הוצאות אחרות מעת לעת.',
      options: [
        { id: 'never', label: 'אף פעם' },
        { id: 'once', label: 'פעם אחת' },
        { id: 'few', label: '2–3 פעמים' },
        { id: 'many', label: '4–6 פעמים' },
        { id: 'most', label: 'כמעט בכל חודש' },
        { id: 'prefer', label: 'מעדיף/ה לא להשיב' },
      ],
    },
    {
      // A forced choice — it separates three needs that look identical: P4 · P6 · P11.
      id: 'a_priority',
      type: 'single',
      showIf: inA,
      prompt: 'מה חשוב לך יותר כרגע במשכנתה שלך?',
      options: [
        { id: 'lower_monthly', label: 'להקטין את ההחזר החודשי' },
        { id: 'lower_total', label: 'להקטין את העלות הכוללת' },
        { id: 'stability', label: 'יציבות וודאות בתשלום' },
        { id: 'flexibility', label: 'גמישות לפירעון מוקדם' },
        { id: 'dontknow', label: 'לא יודע/ת' },
      ],
    },
    {
      // H4 + the 40/40 quota (with an adviser / without).
      id: 'a_advisor',
      type: 'single',
      showIf: inA,
      prompt: 'האם נעזרת ביועץ משכנתאות כאשר לקחת או שינית את המשכנתה?',
      options: [
        { id: 'private', label: 'כן, ביועץ פרטי מטעמי' },
        { id: 'bank_rep', label: 'רק בגורם מטעם הבנק' },
        { id: 'third_party', label: 'כן, בגורם מטעם קבלן, מתווך או גוף אשראי' },
        { id: 'no', label: 'לא נעזרתי באיש מקצוע' },
      ],
    },
    {
      // Decision 7.1 folded into a single question: the "unexpected" option replaces
      // the separate bridge screen. It identifies P3 (home upgraders) · P6
      // (increasing the loan) · P10/P12 (buying out a share) · P11 (investment).
      id: 'a_deal_type',
      type: 'single',
      showIf: inA,
      prompt: 'האם צפויה לך עסקת נדל"ן חדשה ב-12 החודשים הקרובים, ואם כן — מהי?',
      options: [
        { id: 'none', label: 'לא צפויה לי עסקה חדשה' },
        { id: 'upgrade', label: 'שיפור דיור — מכירת הדירה הקיימת ורכישת אחרת' },
        { id: 'investment', label: 'דירה להשקעה' },
        { id: 'additional', label: 'רכישת דירה נוספת למגורים' },
        { id: 'build', label: 'בנייה עצמית על מגרש' },
        { id: 'share', label: 'רכישת חלק בנכס — ירושה, גירושים או שותפות' },
        { id: 'increase', label: 'הגדלת המשכנתה על הנכס הקיים — שיפוץ או הרחבה' },
        { id: 'other', label: 'עסקה אחרת' },
      ],
    },
    {
      // Unprimed need — it has to stay ahead of the concept screen.
      // In the lean version it is also the feature-fit measure (a 40% threshold), in
      // place of the post-exposure capabilities question.
      id: 'a_easier',
      type: 'multi',
      showIf: inA,
      prompt:
        'לפני שנציג פתרון כלשהו — אילו שתי פעולות הקשורות למשכנתה היית הכי רוצה שיהיו קלות יותר?',
      maxSelections: 2,
      shuffleOptions: true,
      options: [
        { id: 'understand', label: 'להבין מה יש לי כיום במשכנתה' },
        { id: 'track', label: 'לעקוב אחרי שינויים לאורך זמן' },
        { id: 'compare', label: 'להשוות הצעות בין בנקים' },
        { id: 'simulate', label: 'לדעת מראש איך שינוי ישפיע עליי' },
        { id: 'docs', label: 'לרכז ולנהל מסמכים' },
        { id: 'refi', label: 'לבדוק אם כדאי למחזר' },
        { id: 'talk_bank', label: 'לנהל את השיחה מול הבנק' },
        { id: 'advisor_work', label: 'לעבוד מול יועץ בצורה מסודרת' },
      ],
    },
    {
      id: 'a_concept',
      type: 'info',
      showIf: inA,
      title: 'לפני שנסיים — על מה אנחנו עובדים',
      body: 'אנחנו בוחנים כלי שמאפשר לראות את המשכנתה הקיימת במקום אחד, להשוות חלופות ולהבין כיצד שינויים עשויים להשפיע עליה — על בסיס נתונים שהמשתמש מזין או מחבר.\n\nהכלי אינו מחליף את ההחלטה שלך, אינו נותן ייעוץ ואינו מבטיח חיסכון.',
      cta: 'הבנתי, נמשיך',
    },
    {
      // BES-C — the outcome variable of the commercial validation.
      id: 'a_commit',
      type: 'single',
      showIf: inA,
      prompt: 'מהי הפעולה הממשית ביותר שהיית מוכן/ה לבצע בשבוע הקרוב?',
      options: [
        { id: 'read', label: 'לקרוא מידע או מדריך' },
        { id: 'enter', label: 'להזין את נתוני המשכנתה שלי' },
        { id: 'call', label: 'לקבוע שיחה של 20 דקות' },
        { id: 'upload', label: 'להעלות מסמך מושחר' },
        { id: 'pay', label: 'לשלם עבור בדיקה' },
        { id: 'none', label: 'אף אחת מהפעולות' },
      ],
      next: [{ goto: 'd_household' }],
    },

    // ───────────────────────── track B · 7 questions ─────────────────────────
    {
      // Decision 7.2 — it separates 8 of the 9 B personas. Without it they all look identical in the data.
      id: 'b_deal_type',
      type: 'single',
      showIf: inB,
      prompt: 'מהי העסקה שבגללה את/ה מעריך/ה שתבקש/י משכנתה?',
      options: [
        { id: 'first', label: 'דירה ראשונה' },
        { id: 'upgrade', label: 'שיפור דיור — מכירת הדירה הקיימת ורכישת אחרת' },
        { id: 'investment', label: 'דירה להשקעה' },
        { id: 'build', label: 'בנייה עצמית על מגרש' },
        { id: 'share', label: 'רכישת חלק בנכס — ירושה, גירושים או שותפות' },
        { id: 'increase', label: 'הגדלת המשכנתה על נכס קיים — שיפוץ או הרחבה' },
        { id: 'other', label: 'אחר' },
      ],
    },
    {
      // The sharpest test of P1: a rule of thumb versus a proper budget. Behaviour, not opinion.
      id: 'b_ceiling',
      type: 'single',
      showIf: inB,
      prompt: 'האם הגדרת לעצמך החזר חודשי מרבי, וכיצד הגעת אליו?',
      options: [
        { id: 'none', label: 'לא הגדרתי תקרה' },
        { id: 'budget', label: 'כן — לפי תקציב מפורט שעשיתי' },
        { id: 'rule', label: 'כן — לפי כלל אצבע או תחושה' },
        { id: 'bank', label: 'כן — לפי מה שהבנק אמר' },
        { id: 'advisor', label: 'כן — לפי מה שיועץ אמר' },
        { id: 'partner', label: 'כן — בהתייעצות עם בן/בת הזוג' },
      ],
    },
    {
      // B's central pain measure.
      id: 'b_unclear',
      type: 'multi',
      showIf: inB,
      prompt: 'איזה חלק בתהליך אינו ברור לך כרגע?',
      maxSelections: 3,
      shuffleOptions: true,
      options: [
        { id: 'amount', label: 'איזה סכום נכון לקחת' },
        { id: 'monthly', label: 'מה יהיה ההחזר החודשי' },
        { id: 'tracks', label: 'מהם המסלולים ואיך בונים תמהיל' },
        { id: 'rates', label: 'ריביות והצמדות' },
        { id: 'risks', label: 'מהם הסיכונים' },
        { id: 'docs', label: 'אילו מסמכים נדרשים' },
        { id: 'banks', label: 'איך משווים בין בנקים' },
        { id: 'advisor', label: 'האם צריך יועץ ואיך בוחרים' },
        { id: 'property', label: 'איך המימון מתחבר לעסקה עצמה' },
        { id: 'clear', label: 'הכול ברור לי', exclusive: true },
      ],
    },
    {
      // The four SURE items on one screen — decisional conflict (0–4) + H7.
      id: 'b_sure',
      type: 'multi',
      showIf: inB,
      prompt: 'אילו מהמשפטים הבאים נכונים לגביך כרגע?',
      options: [
        { id: 'certain', label: 'אני מרגיש/ה בטוח/ה מהי הבחירה הטובה עבורי' },
        { id: 'informed', label: 'ברור לי מה היתרונות והסיכונים של החלופות' },
        { id: 'values', label: 'ברור לי אילו יתרונות וסיכונים חשובים לי ביותר' },
        { id: 'support', label: 'יש לי מספיק תמיכה ועצה כדי לבחור' },
        { id: 'none', label: 'אף אחד מהמשפטים אינו נכון לגביי', exclusive: true },
      ],
    },
    {
      // A central barrier · it hosts gap 2 (P5 — income from abroad) and gap 3 (P2/P10/P12 — age).
      id: 'b_delay',
      type: 'single',
      showIf: inB,
      prompt: 'מה הדבר העיקרי שעלול לעכב אותך?',
      options: [
        { id: 'equity', label: 'חוסר בהון עצמי' },
        { id: 'income', label: 'הכנסה או יציבות תעסוקתית' },
        { id: 'foreign', label: 'הכנסה או מסמכים מחו"ל' },
        { id: 'docs', label: 'ריכוז המסמכים' },
        { id: 'property', label: 'לא נמצא נכס מתאים' },
        { id: 'prices', label: 'מחירי הנכסים' },
        { id: 'knowledge', label: 'חוסר ידע או ביטחון בהחלטה' },
        { id: 'partner', label: 'תיאום עם בן/בת הזוג או עם צד שלישי' },
        { id: 'long_commitment', label: 'חשש מהתחייבות ארוכת טווח בגיל שלי' },
        { id: 'nothing', label: 'שום דבר — התהליך מתקדם' },
        { id: 'other', label: 'אחר' },
      ],
    },
    {
      // Unprimed need, ahead of the exposure. It doubles as the feature-fit measure (a 40% threshold).
      id: 'b_confident',
      type: 'multi',
      showIf: inB,
      prompt: 'לפני שנציג פתרון כלשהו — אילו שתי פעולות היית רוצה לבצע בביטחון רב יותר?',
      maxSelections: 2,
      shuffleOptions: true,
      options: [
        { id: 'budget', label: 'לקבוע כמה נכון לי לקחת' },
        { id: 'compare', label: 'להשוות בין הצעות של בנקים' },
        { id: 'tracks', label: 'לבחור תמהיל ומסלולים' },
        { id: 'risk', label: 'להבין מה קורה אם משהו משתנה' },
        { id: 'docs', label: 'לרכז ולהגיש מסמכים' },
        { id: 'negotiate', label: 'לנהל משא ומתן מול הבנק' },
        { id: 'advisor', label: 'לבחור יועץ ולעבוד מולו' },
        { id: 'timing', label: 'לתזמן נכון בין העסקה למימון' },
      ],
    },
    {
      id: 'b_concept',
      type: 'info',
      showIf: inB,
      title: 'לפני שנסיים — על מה אנחנו עובדים',
      body: 'אנחנו בוחנים כלי שמלווה את התהליך לקראת משכנתה: מרכז את הנתונים, מציג חלופות ומסביר מה ההבדל ביניהן, ועוזר להתכונן לשיחה מול הבנק.\n\nהכלי אינו מחליף את ההחלטה שלך, אינו נותן ייעוץ ואינו מבטיח תנאים כלשהם.',
      cta: 'הבנתי, נמשיך',
    },
    {
      // BES-C
      id: 'b_commit',
      type: 'single',
      showIf: inB,
      prompt: 'איזו פעולה תהיה מוכן/ה לבצע כעת?',
      options: [
        { id: 'read', label: 'לקרוא מידע או מדריך' },
        { id: 'simulate', label: 'להזין נתונים ולהריץ סימולציה' },
        { id: 'waitlist', label: 'להירשם לרשימת המתנה' },
        { id: 'call', label: 'לקבוע שיחה של 20 דקות' },
        { id: 'upload', label: 'להעלות מסמך מושחר' },
        { id: 'deposit', label: 'להפקיד פיקדון בר-החזר' },
        { id: 'none', label: 'אף אחת מהפעולות' },
      ],
      next: [{ goto: 'd_household' }],
    },

    // ───────────────────────── track C · 7 questions ─────────────────────────
    {
      id: 'c_housing',
      type: 'single',
      showIf: inC,
      prompt: 'מה מתאר בצורה הטובה ביותר את מצב הדיור שלך כיום?',
      help: 'אין הנחה שאת/ה אמור/ה לקחת משכנתה. אנחנו רוצים להבין כיצד הנושא משתלב, אם בכלל, בתוכניות שלך.',
      options: [
        { id: 'rent', label: 'שוכר/ת' },
        { id: 'family', label: 'גר/ה עם משפחה' },
        { id: 'owner_free', label: 'בעל/ת נכס ללא משכנתה' },
        { id: 'other', label: 'דיור אחר' },
      ],
    },
    {
      // The competition for attention — segment C's central insight.
      id: 'c_financial_goal',
      type: 'single',
      showIf: inC,
      prompt: 'מהי המטרה הפיננסית המרכזית שאת/ה עובד/ת עליה כרגע?',
      options: [
        { id: 'housing', label: 'דיור — חיסכון לדירה' },
        { id: 'savings', label: 'חיסכון כללי או קרן חירום' },
        { id: 'debt', label: 'סגירת חובות או הלוואות' },
        { id: 'children', label: 'הוצאות על ילדים או חינוך' },
        { id: 'business', label: 'עסק או קריירה' },
        { id: 'studies', label: 'לימודים' },
        { id: 'daily', label: 'פשוט לסגור את החודש' },
        { id: 'none', label: 'אין לי מטרה מוגדרת כרגע' },
      ],
    },
    {
      id: 'c_reason',
      type: 'single',
      showIf: inC,
      prompt: 'מה הסיבה העיקרית לכך שאינך קרוב/ה יותר לתהליך?',
      options: [
        { id: 'equity', label: 'אין מספיק הון עצמי' },
        { id: 'income', label: 'ההכנסה אינה מספיקה או אינה יציבה' },
        { id: 'prices', label: 'מחירי הדירות' },
        { id: 'uncertainty', label: 'אי-ודאות כללית' },
        { id: 'geography', label: 'לא ברור לי איפה ארצה לגור' },
        { id: 'prefer_rent', label: 'מעדיף/ה לשכור' },
        { id: 'knowledge', label: 'לא יודע/ת מאיפה להתחיל' },
        { id: 'other_priority', label: 'יש לי עדיפות אחרת כרגע' },
      ],
    },
    {
      // Triggers — H5.
      id: 'c_conditions',
      type: 'multi',
      showIf: inC,
      prompt: 'אילו שני תנאים צריכים להשתנות כדי שתתחיל/י לפעול?',
      maxSelections: 2,
      shuffleOptions: true,
      options: [
        { id: 'equity', label: 'שיהיה לי הון עצמי מספיק' },
        { id: 'income', label: 'שההכנסה שלי תעלה או תתייצב' },
        { id: 'prices', label: 'שמחירי הדירות יירדו' },
        { id: 'rates', label: 'שהריבית תרד' },
        { id: 'partner', label: 'שיהיה לי בן/בת זוג או שנחליט יחד' },
        { id: 'knowledge', label: 'שאבין את התהליך' },
        { id: 'family', label: 'שינוי במצב המשפחתי' },
        { id: 'job', label: 'שינוי בעבודה או במקום המגורים' },
      ],
    },
    {
      // C's counterpart to pain — a perceived barrier.
      id: 'c_barriers',
      type: 'matrix',
      showIf: inC,
      prompt: 'עד כמה הנושאים הבאים מרגישים לך רחוקים או מורכבים?',
      items: [
        { id: 'equity', label: 'לצבור הון עצמי' },
        { id: 'prices', label: 'מחירי הדירות' },
        { id: 'mortgage', label: 'תהליך המשכנתה עצמו' },
        { id: 'tracks', label: 'מסלולים וריביות' },
      ],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'קרוב ופשוט',
      maxLabel: 'רחוק ומורכב',
      naLabel: 'לא רלוונטי',
      shuffleItems: true,
    },
    {
      // H8 — the smallest entry product. Unprimed need, ahead of the exposure.
      id: 'c_small_action',
      type: 'multi',
      showIf: inC,
      prompt: 'איזו פעולה קטנה הייתה מועילה לך כיום?',
      maxSelections: 2,
      shuffleOptions: true,
      options: [
        { id: 'target', label: 'לקבוע יעד הון עצמי ולראות כמה זמן ייקח' },
        { id: 'forecast', label: 'לראות תחזית — מה אוכל לקנות בעוד כמה שנים' },
        { id: 'monthly', label: 'לבנות תוכנית חיסכון חודשית' },
        { id: 'explain', label: 'הסבר פשוט על איך משכנתה עובדת' },
        { id: 'reminder', label: 'תזכורת כשמשהו רלוונטי משתנה' },
        { id: 'none', label: 'אין צורך בשום דבר מאלה', exclusive: true },
      ],
    },
    {
      id: 'c_concept',
      type: 'info',
      showIf: inC,
      title: 'לפני שנסיים — על מה אנחנו עובדים',
      body: 'אנחנו בוחנים כלי שעוזר להיערך מוקדם: לקבוע יעד הון עצמי, לראות כמה זמן ייקח להגיע אליו ולהבין מה נדרש — בלי צורך להגיש בקשת משכנתה או לדבר עם בנק.\n\nהכלי אינו נותן ייעוץ ואינו מבטיח תוצאה.',
      cta: 'הבנתי, נמשיך',
    },
    {
      // BES-C. 'deposit' is the strongest commitment signal in C, so it is folded in
      // here rather than asked as a separate question (C22 in the skeleton).
      id: 'c_commit',
      type: 'single',
      showIf: inC,
      prompt: 'איזו פעולה תהיה מוכן/ה לבצע השבוע?',
      options: [
        { id: 'read', label: 'לקרוא מידע או מדריך' },
        { id: 'target', label: 'להזין יעד הון עצמי' },
        { id: 'reminder', label: 'להירשם לתזכורת' },
        { id: 'call', label: 'לקבוע שיחה של 20 דקות' },
        { id: 'deposit', label: 'להפעיל הוראת חיסכון חודשית קבועה' },
        { id: 'none', label: 'אף אחת מהפעולות' },
      ],
    },

    // ──────────── demographics · 3 questions (age is taken from s_age) ────────────
    {
      id: 'd_household',
      type: 'single',
      prompt: 'מה מתאר את משק הבית שלך?',
      options: [
        { id: 'single', label: 'יחיד/ה' },
        { id: 'couple', label: 'זוג ללא ילדים' },
        { id: 'family', label: 'משפחה עם ילדים' },
        { id: 'single_parent', label: 'הורה יחיד/ה' },
        { id: 'with_parents', label: 'גר/ה עם ההורים' },
        { id: 'roommates', label: 'שותפים' },
        { id: 'other', label: 'אחר' },
      ],
    },
    {
      // Multi-choice deliberately: it handles "both employed and self-employed" (P8), and hosts S8 without another screen.
      id: 'd_employment',
      type: 'multi',
      prompt: 'אילו מהמצבים הבאים מתארים אותך?',
      options: [
        { id: 'employee', label: 'שכיר/ה' },
        { id: 'self_employed', label: 'עצמאי/ת' },
        { id: 'unemployed', label: 'לא עובד/ת כרגע' },
        { id: 'retired', label: 'גמלאי/ת' },
        { id: 'student', label: 'סטודנט/ית' },
        {
          id: 'industry',
          label: 'אני, או בן/בת משפחה מדרגה ראשונה, עובדים בבנק, בגוף אשראי או בייעוץ משכנתאות',
        },
      ],
    },
    {
      id: 'd_income',
      type: 'single',
      prompt: 'מהי הכנסת משק הבית נטו בחודש רגיל?',
      options: [
        { id: 'upto10', label: 'עד 10,000 ש"ח' },
        { id: 'r10_15', label: '10,001–15,000 ש"ח' },
        { id: 'r15_20', label: '15,001–20,000 ש"ח' },
        { id: 'r20_30', label: '20,001–30,000 ש"ח' },
        { id: 'r30_40', label: '30,001–40,000 ש"ח' },
        { id: 'over40', label: 'מעל 40,000 ש"ח' },
        { id: 'prefer', label: 'מעדיף/ה לא להשיב' },
      ],
    },

    // ──────────────────────────── ending and commitment ────────────────────────────
    {
      // The contact details themselves are collected in a separate external form — the skeleton's privacy principle.
      id: 'end_followup',
      type: 'single',
      prompt: 'האם תרצה/י להשתתף בבדיקת המשך קצרה?',
      help: 'פרטי הקשר ייאספו בטופס נפרד ולא יישמרו יחד עם התשובות שלך.',
      options: [
        { id: 'yes', label: 'כן, אשמח' },
        { id: 'no', label: 'לא, תודה' },
      ],
    },
    {
      id: 'end_complete',
      type: 'end',
      variant: 'complete',
      title: 'תודה רבה!',
      body: 'התשובות נשמרו. תרומתך עוזרת לנו להבין מה באמת חסר לאנשים בתהליך המשכנתה.',
    },
    {
      id: 'end_screenout',
      type: 'end',
      variant: 'screenout',
      title: 'תודה על ההתעניינות',
      body: 'השאלון אינו מתאים למצבך הנוכחי, ולכן נסיים כאן. תודה רבה על הזמן!',
    },
  ],
};
