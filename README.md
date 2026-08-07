# שאלון מחקר לאישוש פרסונות — משכנתאות

אפליקציית שאלון בעברית (RTL, mobile-first) לאיסוף תשובות לוולידציה של פרסונות מוצר המשכנתאות.
מבוססת על שלד המחקר בקונפלואנס (MTG, עמוד 13729793). Linear: BIZ-15.

## ארכיטקטורה

- **פרונט:** React + Vite, סטטי לחלוטין. מתארח ב-Netlify (חינם).
- **דאטה:** Supabase (Postgres חינמי). מודל **append-only**: כל צפייה במסך, תשובה וסיום
  נשלחים כאירוע לטבלת `survey_events`. המפתח הציבורי בדפדפן יכול **רק להכניס** שורות
  (RLS insert-only) — אי אפשר לקרוא או למחוק דרכו נתוני משיבים.
- **השאלון עצמו הוא קונפיג** — `src/questionnaire/*.ts`. שינוי נוסח = עריכת קובץ, בלי לגעת במנוע.
- **אמינות:** תור אירועים ב-localStorage עם retry; רענון עמוד לא מאבד תשובות (event_uid ייחודי
  מונע כפילויות); flush אחרון ב-pagehide.
- **מצב פיתוח:** בלי `.env` האפליקציה רצה רגיל אבל האירועים נכתבים לקונסול בלבד.

## יכולות המנוע (מה שהשלד המחקרי דורש)

- ניתוב מותנה ודילוגים (`showIf`, `next`), כולל תנאים משולבים (מקטע B = צפי ≤ 12 חודשים
  **וגם** פעולה ממשית — `all`/`any`/`not`)
- משתני סשן מוגרלים (`randomVars`) — למשל מחיר לניסוי B39 — עם שיבוץ בנוסח: `{price}`
- ערבוב סדר פריטים ואפשרויות (`shuffleItems`/`shuffleOptions`), הסדר נשמר בנתונים
- אפשרות בלעדית ברב-ברירה ("אף אחד מאלה"), מגבלת בחירות (`maxSelections`)
- פאראדאטה מלאה: זמן פר מסך, נשירה פר מסך, honeypot לבוטים
- לכידת פרמטרים מה-URL (מקור הפצה, מזהה פאנל) — `?source=...&pid=...` נשמרים אוטומטית

## הרצה מקומית

```bash
npm install
npm run dev        # מצב פיתוח — בלי שליחה לשרת
npm test           # בדיקות מנוע התנאים
```

חיבור ל-Supabase: `cp .env.example .env` ומילוי שני המשתנים.

## הקמת Supabase (חד-פעמי)

1. פרויקט חדש ב-[supabase.com](https://supabase.com) (החינמי מספיק בענק).
2. SQL Editor → הדבקת `supabase/schema.sql` → Run.
3. Project Settings → API → העתקת `URL` ו-`anon public` key אל `.env` (מקומית)
   ואל משתני הסביבה ב-Netlify.

## פריסה ל-Netlify

```bash
npm install -g netlify-cli
netlify login
netlify init       # יצירת אתר חדש
netlify env:set VITE_SUPABASE_URL "https://<project>.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "<anon key>"
netlify deploy --build --prod
```

## שליפת נתונים לניתוח

הדפדפן לא יכול לקרוא נתונים (בכוונה). הייצוא נעשה מדשבורד Supabase:

- **SQL Editor** → `select * from completed_responses` → Export CSV — תשובה מלאה לשורה.
- `select * from screen_funnel order by screen_id` — נשירה וזמנים פר מסך (בקרת איכות הפיילוט).
- הטבלה הגולמית `survey_events` זמינה לניתוח עומק ב-Python/R.

## מבנה האירועים

| event_type | מתי | payload |
|---|---|---|
| `session_start` | כניסה ראשונה | משתנים מוגרלים, פרמטרי URL, דפדפן |
| `screen_view` | כל הצגת מסך | אינדקס המסך |
| `answer` | כל מענה | הערך, זמן במסך (ms), סדר פריטים אם עורבב |
| `complete` / `screenout` | מסך סיום | צילום מלא של כל התשובות והמשתנים |
