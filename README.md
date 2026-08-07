# שאלון מחקר לאישוש פרסונות — משכנתאות

אפליקציית שאלון בעברית (RTL, mobile-first) לאיסוף תשובות לוולידציה של פרסונות מוצר המשכנתאות.
מבוססת על שלד המחקר בקונפלואנס (MTG, עמוד 13729793). Linear: BIZ-15.

## ארכיטקטורה

- **פרונט:** React + Vite, סטטי. מתארח ב-Netlify (חינם). **אין שום מפתח API בדפדפן.**
- **דאטה:** Supabase (Postgres חינמי). מודל **append-only**: כל צפייה במסך, תשובה וסיום
  נשלחים כאירוע ל-Netlify Function (`netlify/functions/events.mts`), שמוולד אותם
  ומכניס לטבלת `survey_events` עם ה-service_role key (שחי רק בסביבת השרת של Netlify).
  לדפדפן אין גישה ישירה ל-DB בכלל — RLS חוסם את anon לגמרי, גם לכתיבה.
- **השאלון עצמו הוא קונפיג** — נערך בקונסולת הניהול (`/admin`) ונשמר ב-Supabase:
  טיוטה יחידה (`survey_drafts`) + גרסאות שפורסמו (`survey_configs`, append-only עם
  trigger שחוסם שינוי). האפליקציה טוענת את הגרסה הפעילה דרך
  `netlify/functions/config-get.mts`. **סשן מוצמד לגרסה שבה התחיל** — פרסום גרסה
  חדשה לא משפיע על משיב באמצע שאלון. במצב פיתוח נטען שאלון הדגמה המקומי
  (`src/questionnaire/placeholder.ts`), שמשמש גם כזרע לטיוטה הראשונה.
- **קונסולת ניהול** ב-`/admin` (chunk נפרד — לא מגיע למשיבים): רשימת מסכים עם
  גרירה-ושחרור לשינוי סדר, עורך תנאים (showIf/next/onSubmit), ולידציה חיה —
  כולל זיהוי מעגלי ניתוב, יעדי goto שבורים ומסכים לא נגישים — ופרסום גרסאות.
  הוולידציה נאכפת גם בשרת (`admin-publish.mts`, אותו `validateConfig` בדיוק).
- **כניסה לקונסולה:** Google Sign-In, מוגבל לחשבונות `first-edea.com` בלבד.
  האכיפה בצד השרת (`admin-auth.mts` מאמת את ה-token מול גוגל ובודק דומיין),
  עוגיית סשן HMAC חתומה HttpOnly ל-12 שעות.
- **אמינות:** תור אירועים ב-localStorage עם retry; רענון עמוד לא מאבד תשובות (event_uid ייחודי
  מונע כפילויות); flush אחרון ב-pagehide.
- **מצב פיתוח:** ב-`npm run dev` האירועים נכתבים לקונסול בלבד. בדיקת הצינור המלא מקומית:
  `netlify serve` (בילד פרודקשן + פונקציות, עם `.env`).

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

בדיקת הצינור המלא מקומית (פונקציות + Supabase, כולל `/admin`): `cp .env.example .env`,
מילוי המשתנים, ואז `netlify serve`. ב-`npm run dev` הקונסולה תציג מסך כניסה אבל
הפונקציות לא רצות — עבודה על `/admin` דורשת `netlify serve` (או `netlify dev`).
שימו לב: עוגיית הסשן מסומנת `Secure`; ב-http://localhost זה עובד בכרום אבל עלול
להיכשל בספארי — לבדיקה מקומית של הקונסולה עדיף Chrome.

## הקמת Google OAuth לקונסולה (חד-פעמי)

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create
   Credentials → OAuth client ID → Web application.
2. Authorized JavaScript origins: `http://localhost:8888` (ל-netlify serve) + כתובת
   האתר ב-Netlify.
3. את ה-Client ID לשים גם ב-`GOOGLE_CLIENT_ID` וגם ב-`VITE_GOOGLE_CLIENT_ID`
   (זה מזהה ציבורי, לא סוד). לייצר `ADMIN_SESSION_SECRET` עם `openssl rand -base64 32`.
4. ההגבלה לדומיין `first-edea.com` נאכפת בקוד השרת — אין צורך בהגדרה בגוגל.

## זרימת עריכה ופרסום

1. נכנסים ל-`/admin` עם חשבון first-edea.com.
2. בפעם הראשונה: "יצירת טיוטה מהדמו" — הטיוטה נוצרת משאלון ההדגמה.
3. עורכים: גרירת מסכים לשינוי סדר, לחיצה על מסך לעריכת נוסח/תנאים/ניתוב.
   שמירה (או Ctrl/Cmd+S) שומרת טיוטה — בלי להשפיע על המשיבים.
4. "פרסום" מריץ ולידציה (שגיאות חוסמות: מעגלים, goto שבור, הפניות לא קיימות)
   ויוצר גרסה קבועה `YYYY-MM-DD.N`. סשנים חדשים מקבלים אותה מיד (עד דקה של cache);
   משיבים באמצע ממשיכים בגרסה שלהם.

## הקמת Supabase (חד-פעמי)

1. פרויקט חדש ב-[supabase.com](https://supabase.com) (החינמי מספיק בענק).
2. SQL Editor → הדבקת `supabase/schema.sql` → Run. (שינוי בסכמה/הרשאות? להריץ שוב —
   הקובץ בריפו לא משנה כלום בעצמו.)
3. Project Settings → API → העתקת `URL` וה-`service_role` key (לא anon!) — למשתני
   הסביבה ב-Netlify (ראו למטה) ול-`.env` מקומי אם רוצים לבדוק עם `netlify serve`.

⚠️ ה-service_role key הוא סוד גמור: הוא חי רק במשתני הסביבה של Netlify וב-`.env`
(שמוחרג מגיט). לעולם לא בקוד, לעולם לא עם קידומת `VITE_`.

## פריסה ל-Netlify

```bash
npm install -g netlify-cli
netlify login
netlify deploy --build --prod   # בהרצה הראשונה: לבחור "Create & configure a new project"
netlify env:set SUPABASE_URL "https://<project>.supabase.co"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "<service_role key>"
netlify env:set GOOGLE_CLIENT_ID "<oauth client id>"
netlify env:set VITE_GOOGLE_CLIENT_ID "<oauth client id>"
netlify env:set ADMIN_SESSION_SECRET "$(openssl rand -base64 32)"
netlify deploy --build --prod   # שוב, כדי שהפונקציה תיפרס עם משתני הסביבה
```

(אין צורך בריפו GitHub לפריסה ידנית; בהמשך אפשר לחבר ריפו לפריסה אוטומטית בכל push.)

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
