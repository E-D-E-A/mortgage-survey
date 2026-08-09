// הליכה על השאלון האמיתי במובייל, עם צילום של כל סוג מסך פעם אחת: פתיחה,
// הסכמה, מספר, בחירה יחידה, מטריצה (ריקה ומלאה), רב-ברירה, טקסט, סיום.
//
//   node qa/survey-walk.mjs [רוחב] [גובה]

import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BASE_URL, contextOptions } from './harness.mjs';

const width = Number(process.argv[2] ?? 390);
const height = Number(process.argv[3] ?? 844);
// ניקוי לפני הרצה: המסכים ממוספרים לפי סדר ההופעה, וקובץ שנשאר מהרצה קודמת
// יושב בין החדשים עם מספר שגוי ונקרא כאילו הוא חלק מהמסלול הנוכחי
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', `survey-${width}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...contextOptions({ width, height }), deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('שגיאת דף:', e.message));

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.card h1');

let n = 0;
const seen = new Set();
const shot = async (name) => {
  if (seen.has(name)) return;
  seen.add(name);
  n += 1;
  await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) });
};

/**
 * סוג המסך נגזר מה-DOM ולא מהקונפיג — כך ההליכה עובדת על כל שאלון.
 *
 * ⚠ שדות הקלט מזוהים לפי ‎.input‎ ולא לפי ‎type‎ לבדו: מסך ההסכמה נושא honeypot
 * מוסתר שהוא ‎input[type=text]‎, ובלי ההגבלה הוא נספר כמסך טקסט — ואז הבדיקה
 * מחכה לשדה שלא קיים עד שנגמר הזמן.
 */
const screenType = () =>
  page.evaluate(() => {
    if (document.querySelector('.end-icon')) return 'end';
    if (document.querySelector('.matrix-item')) return 'matrix';
    if (document.querySelector('[role=checkbox]')) return 'multi';
    if (document.querySelector('[role=radio]')) return 'single';
    if (document.querySelector('textarea.input')) return 'textarea';
    if (document.querySelector('input[type=number].input')) return 'number';
    if (document.querySelector('input[type=text].input')) return 'text';
    if (document.querySelector('.actions .btn.secondary')) return 'consent';
    return 'info';
  });

// תקרה קשיחה: שאלון עם לולאה לא יתקע את הבדיקה
for (let step = 0; step < 60; step++) {
  const type = await screenType();
  await shot(type);
  if (type === 'end') break;

  if (type === 'matrix') {
    const rows = await page.locator('.matrix-item').count();
    for (let r = 0; r < rows; r++) {
      await page.locator('.matrix-item').nth(r).locator('.scale-btn').nth(2).click();
    }
    await page.waitForTimeout(150);
    await shot('matrix-filled');
  } else if (type === 'multi') {
    await page.locator('[role=checkbox]').first().click();
    await page.locator('[role=checkbox]').nth(1).click().catch(() => {});
    await page.waitForTimeout(120);
    await shot('multi-selected');
  } else if (type === 'single') {
    await page.locator('[role=radio]').first().click();
  } else if (type === 'number') {
    await page.locator('input[type=number]').fill('37');
    await page.waitForTimeout(120);
    await shot('number-filled');
  } else if (type === 'text' || type === 'textarea') {
    await page.locator('.input').first().fill('טקסט לדוגמה כדי לראות איך נראה השדה');
    await page.waitForTimeout(120);
    await shot(`${type}-filled`);
  }

  await page.locator('.btn.primary').first().click();
  await page.waitForTimeout(250);
}

await browser.close();
console.log(`צילומים: ${OUT}`);
