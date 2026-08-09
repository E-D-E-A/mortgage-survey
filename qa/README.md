# בדיקות ממשק ידניות (Playwright)

בדיקות שמריצות דפדפן אמיתי מול `npm run dev` ומצלמות את שני הממשקים —
**השאלון** (`/`) ו**קונסולת הניהול** (`/admin`). הן משלימות את `npm test`,
שבודק את מנוע התנאים בלבד ולא רואה פיקסל אחד.

הדבר היקר כאן הוא [`harness.mjs`](harness.mjs): הוא נותן כניסה ל-`/admin`
**בלי חשבון Google ובלי לגעת ב-Supabase**. הרתמה הזאת אבדה כבר פעם אחת
(היא ישבה ב-scratchpad של סשן), והשחזור שלה עלה יותר מכל שאר הבדיקות יחד.

## הרצה

Playwright אינו תלות של הפרויקט — המשיבים לא צריכים אותו בבאנדל, ואין סיבה
שכל `npm install` יוריד דפדפן של 150MB. מתקינים אותו פעם אחת, מקומית:

```bash
npm install --no-save playwright
npx playwright install chromium
```

ואז, בטרמינל אחד:

```bash
npm run dev -- --port 5199
```

ובשני:

```bash
node qa/responsive.mjs     # סריקת 320/390/768/1440 — נופלת על גלישה או שגיאת קונסול
node qa/survey-walk.mjs    # הליכה על השאלון, צילום של כל סוג מסך
node qa/graph-touch.mjs    # צביטה ופאן בתרשים הזרימה
```

הצילומים נכתבים ל-`qa/shots/` (לא נכנס ל-git).

כתובת אחרת: `QA_BASE_URL=http://localhost:3000 node qa/responsive.mjs`.

## מה הרתמה עושה

1. **סשן מזויף** — `addInitScript` שכותב ל-`localStorage` את המפתח
   `sb-<project-ref>-auth-token` (ה-ref נקרא מ-`VITE_SUPABASE_URL` שב-`.env`).
   ה-`access_token` צריך רק *להיראות* כמו JWT; `supabase-js` קורא אותו ומשדר
   `INITIAL_SESSION` בלי שום קריאת רשת.
2. **חסימת Supabase** — כל בקשה ל-`*.supabase.co` נענית ב-`{}`. שום דבר לא יוצא החוצה.
3. **סטאבים לפונקציות** — `admin-surveys`, `admin-draft` (GET/PUT) ו-`admin-publish`.
   הטיוטה שמוחזרת היא השאלון האמיתי מ-`src/questionnaire/survey-v1.ts`, שנשלף
   מגרף המודולים של vite — כך העורך נבדק על 38 מסכים ולא על דוגמה.

**אפס כתיבה ל-DB האמיתי**, ואין צורך ב-`netlify dev`.

## מה לא מכוסה

- צינור האירועים בפרודקשן (תור ב-localStorage, retry, `flush` ב-`pagehide`) —
  בפיתוח האירועים נכתבים לקונסול בלבד.
- `config-get` והצמדת גרסה לסשן — פעילים רק ב-`import.meta.env.PROD`.
- זרימת ה-OAuth האמיתית מול Google ואכיפת הדומיין בשרת (`lib/session.ts`).
- ה-Netlify Functions עצמן — הן מוחלפות בסטאבים.
- **גרירת צמתים וחיבור קשתות בתרשים במסך מגע.** הם בנויים על pointer events
  ולכן אמורים לעבוד, אבל `graph-touch.mjs` בודק רק צביטה ופאן. הבדיקה גם
  מנטרלת את `setPointerCapture` — היא מאמתת את הלוגיקה, לא את הדפדפן סביבה.
  שווה בדיקה במכשיר אמיתי.
