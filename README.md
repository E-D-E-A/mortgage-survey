# שאלון מחקר לאישוש פרסונות — משכנתאות

אפליקציית שאלון בעברית (RTL, mobile-first) לאיסוף תשובות לוולידציה של פרסונות מוצר המשכנתאות.
מבוססת על שלד המחקר בקונפלואנס (MTG, עמוד 13729793). Linear: BIZ-15.

## ארכיטקטורה

- **פרונט:** React + Vite, סטטי. מתארח ב-Netlify (חינם). **אין שום סוד בדפדפן** —
  ה-service_role key חי רק בסביבת השרת. ה-anon key (ציבורי בהגדרתו) מופיע רק
  ב-chunk של הקונסולה ומשמש את Supabase Auth בלבד; הוא לא מקנה גישה לנתונים.
- **דאטה:** Supabase (Postgres חינמי). מודל **append-only**: כל צפייה במסך, תשובה וסיום
  נשלחים כאירוע ל-Netlify Function (`netlify/functions/events.mts`), שמוולד אותם
  ומכניס לטבלת `survey_events` עם ה-service_role key (שחי רק בסביבת השרת של Netlify).
  לדפדפן אין גישה ישירה ל-DB בכלל — RLS חוסם את anon לגמרי, גם לכתיבה.
- **השאלון עצמו הוא קונפיג** — נערך בקונסולת הניהול (`/admin`) ונשמר ב-Supabase:
  טיוטה לכל שאלון (`survey_drafts`) + גרסאות שפורסמו (`survey_configs`, append-only עם
  trigger שחוסם שינוי). האפליקציה טוענת את הגרסה הפעילה דרך
  `netlify/functions/config-get.mts`. **סשן מוצמד לגרסה שבה התחיל** — פרסום גרסה
  חדשה לא משפיע על משיב באמצע שאלון. במצב פיתוח נטען שאלון הדגמה המקומי
  (`src/questionnaire/placeholder.ts`), שמשמש גם כזרע לטיוטה הראשונה.
- **כמה שאלונים במקביל** — טבלת `surveys` (slug + שם). לכל שאלון טיוטה משלו,
  גרסאות משלו וקישור ציבורי משלו: `/s/<slug>`. הקישור הישן `/` מגיש את שאלון
  ברירת המחדל (`main`), ולכן קישורים שכבר חולקו ממשיכים לעבוד.
  `version` נשאר ייחודי גלובלית ונושא את ה-slug בתוכו (`YYYY-MM-DD.N-<slug>`),
  כי `survey_events` מזהה שאלון דרכו בלבד.
- **קונסולת ניהול** ב-`/admin` (chunk נפרד — לא מגיע למשיבים): רשימת מסכים עם
  גרירה-ושחרור לשינוי סדר, עורך תנאים (showIf/next/onSubmit), ולידציה חיה —
  כולל זיהוי מעגלי ניתוב, יעדי goto שבורים ומסכים לא נגישים — ופרסום גרסאות.
  הוולידציה נאכפת גם בשרת (`admin-publish.mts`, אותו `validateConfig` בדיוק).
- **כניסה לקונסולה:** **Google בלבד**, דרך Supabase Auth (`signInWithOAuth`). אין
  סיסמאות, אין הרשמה עצמית ואין קריפטו מקומי. האכיפה בצד השרת: כל פונקציית אדמין
  מאמתת את ה-access token מול Supabase ודורשת מייל מאומת בדומיין `first-edea.com`
  וזהות Google (`netlify/functions/lib/session.ts`) — הכפתור בדפדפן הוא UX בלבד.
  ביטול גישה = מחיקת/חסימת המשתמש בדשבורד Supabase.
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
מילוי המשתנים, ואז `netlify dev` ופתיחת `http://localhost:8888/admin`.
ב-`npm run dev` הקונסולה תציג מסך כניסה אבל הפונקציות לא רצות — עבודה על `/admin`
דורשת `netlify dev`. לכניסת Google מקומית צריך ש-`http://localhost:8888/admin`
יופיע ב-Redirect URLs בדשבורד Supabase (ראו למטה).

## הקמת כניסת Google לקונסולה (חד-פעמי)

### א. Google Cloud Console

1. [Clients](https://console.cloud.google.com/auth/clients) → Create client →
   **Web application**.
2. **Authorized redirect URIs**: `https://<project>.supabase.co/auth/v1/callback`
   ⚠️ זו כתובת ה-callback של **Supabase**, לא של האתר. הכתובת המדויקת מופיעה
   בדשבורד Supabase בעמוד ספק Google.
3. **Authorized JavaScript origins**: כתובת האתר בפרודקשן + `http://localhost:8888`.
4. **מסך ההסכמה: User type = Internal.** זו האכיפה החזקה ביותר מצד גוגל — חשבון
   שאינו בארגון `first-edea.com` נחסם ע"י גוגל לפני שהבקשה מגיעה ל-Supabase בכלל.
5. לשמור את ה-Client ID וה-Client Secret.

### ב. דשבורד Supabase → Authentication

1. **Providers → Google**: להפעיל ולהדביק Client ID + Client Secret.
   ⚠️ הם נשמרים **רק כאן** — לא בקוד, לא ב-Netlify, לא ב-`.env`.
2. **Providers → Email**: **לכבות.** אין סיסמאות במערכת הזאת.
3. **URL Configuration → Site URL**: `https://<site>/admin`.
   ב-**Redirect URLs** להוסיף גם `http://localhost:8888/admin` לפיתוח מקומי.
   ⚠️ `redirectTo` שאינו ברשימה הזאת מתעלמים ממנו וההפניה נופלת ל-Site URL.
4. **Users**: למחוק משתמשי בדיקה שנוצרו עם סיסמה, כדי שכל החשבונות יהיו
   חשבונות Google נקיים.
5. *(אופציונלי, הגנה לעומק)* **Hooks → Before User Created → Postgres function**:
   לבחור את `public.restrict_signup_to_domain` (מוגדרת ב-`supabase/schema.sql`) —
   כך חשבון שאינו מהדומיין לא נוצר בכלל.

אין הזמנות ואין ניהול סיסמאות: חבר צוות חדש פשוט נכנס עם חשבון Google הארגוני שלו
בפעם הראשונה. הסרת גישה = מחיקת המשתמש (או Ban) בדשבורד — נחסם מיד בקריאה הבאה.

**חשוב:** ההגבלה לדומיין נאכפת בקוד השרת (`requireAdmin`) בכל בקשה. פרמטר `hd`
בכפתור, מסך ההסכמה Internal וה-hook הם שכבות נוספות — לא תחליף.

## ניהול שאלונים

`/admin` מציג את רשימת השאלונים: הקישור הציבורי של כל אחד (עם כפתור העתקה),
מתי עודכנה הטיוטה, כמה גרסאות פורסמו ומה האחרונה. משם יוצרים שאלון חדש
(שם + מזהה לקישור), משנים שם, ונכנסים לעורך של שאלון מסוים (`/admin/<slug>`).

- **המזהה (slug) קבוע.** הוא מופיע בקישור שמחלקים למשיבים ואי אפשר לשנות אותו.
  השם לתצוגה — כן.
- **הקישור מתחיל לעבוד רק אחרי פרסום.** לפני הגרסה הראשונה `/s/<slug>` מציג
  "השאלון לא נמצא".
- **ארכוב במקום מחיקה.** ארכוב מפסיק להגיש את השאלון לסשנים חדשים (410) אבל
  שומר את כל הנתונים והגרסאות, ומשיב שכבר התחיל יכול לסיים — הגרסה שלו מוצמדת
  לסשן. אפשר להחזיר מארכיון בכל רגע.
- **מחיקה אמיתית רק לשאלון שלא פורסם מעולם.** לשאלון שפורסם יש תשובות שמפנות
  לגרסאות שלו, ולכן ה-DB עצמו חוסם את המחיקה (FK מ-`survey_configs`).

## זרימת עריכה ופרסום

1. נכנסים ל-`/admin` עם חשבון first-edea.com ובוחרים שאלון (או יוצרים חדש).
2. שאלון חדש נוצר עם טיוטת שלד (מסך פתיחה + מסך סיום) שאפשר לפרסם מיד;
   שאלון ותיק בלי טיוטה מציע "יצירת טיוטה מהדמו".
3. עורכים: גרירת מסכים לשינוי סדר, לחיצה על מסך לעריכת נוסח/תנאים/ניתוב.
   שמירה (או Ctrl/Cmd+S) שומרת טיוטה — בלי להשפיע על המשיבים.
4. "פרסום" מריץ ולידציה (שגיאות חוסמות: מעגלים, goto שבור, הפניות לא קיימות)
   ויוצר גרסה קבועה `YYYY-MM-DD.N-<slug>`. סשנים חדשים מקבלים אותה מיד (עד דקה
   של cache); משיבים באמצע ממשיכים בגרסה שלהם.

## הקמת Supabase (חד-פעמי)

1. פרויקט חדש ב-[supabase.com](https://supabase.com) (החינמי מספיק בענק).
2. SQL Editor → הדבקת `supabase/schema.sql` → Run. (שינוי בסכמה/הרשאות? להריץ שוב —
   הקובץ בריפו לא משנה כלום בעצמו.)
3. Project Settings → API → העתקת `URL`, ה-`service_role` key וה-`anon` key —
   למשתני הסביבה ב-Netlify (ראו למטה) ול-`.env` מקומי לבדיקה עם `netlify serve`.

⚠️ ה-service_role key הוא סוד גמור: הוא חי רק במשתני הסביבה של Netlify וב-`.env`
(שמוחרג מגיט). לעולם לא בקוד, לעולם לא עם קידומת `VITE_`.
ה-anon key, לעומתו, ציבורי בהגדרתו ומיועד לדפדפן (`VITE_SUPABASE_ANON_KEY`) —
הוא משמש את Supabase Auth ולא מקנה שום גישה לנתונים.

## פריסה ל-Netlify

💰 **פריסה עולה קרדיטים.** בתוכנית החינמית של Netlify יש 300 קרדיטים לחודש, וכל
פריסה לפרודקשן היא **15 קרדיטים קבועים** — כלומר **20 פריסות לכל החודש**, ללא קשר
לגודל השינוי. לכן: לצבור עבודה ולפרוס במכה אחת. `netlify dev` מקומי הוא חינם,
וגם **preview/branch deploys חינמיים** — לאמת שינוי בענף לפני מיזוג ל-main.
כשנגמרים הקרדיטים האתר **מושבת** ("Site not available"), לא רק הפריסות.

**להגדיר את משתני הסביבה לפני הפריסה הראשונה** — כך צריך פריסה אחת ולא שתיים:

```bash
npm install -g netlify-cli
netlify login
netlify link                    # או: netlify init לפרויקט חדש
netlify env:set SUPABASE_URL "https://<project>.supabase.co"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "<service_role key>"
netlify env:set VITE_SUPABASE_URL "https://<project>.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "<anon key>"
netlify deploy --build --prod   # פריסה אחת, אחרי שהמשתנים כבר קיימים
```

אין שום משתנה של Google כאן — ה-Client ID וה-Secret חיים רק בדשבורד Supabase.
מי שמשדרג מגרסאות קודמות צריך לנקות את המשתנים שאינם בשימוש:

```bash
netlify env:unset GOOGLE_CLIENT_ID
netlify env:unset VITE_GOOGLE_CLIENT_ID
netlify env:unset ADMIN_SESSION_SECRET
```

⚠️ אם הריפו מחובר לפריסה אוטומטית — **כל push ל-main הוא 15 קרדיטים.** לעבוד
בענפים ולמזג ל-main רק כשרוצים לפרוס.

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
