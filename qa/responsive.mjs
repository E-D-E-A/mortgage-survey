// סריקת רוחבים: מצלמת את שני הממשקים ב-320 / 390 / 768 / 1440, ונופלת אם
// נמצאה גלישה אופקית או שגיאת קונסול. זו הבדיקה שמריצים אחרי כל שינוי עיצוב.
//
//   node qa/responsive.mjs
//
// דורש ‎npm run dev‎ רץ (ראו qa/README.md).

import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BASE_URL, VIEWPORTS, contextOptions, installHarness, loadQuestionnaire } from './harness.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const config = await loadQuestionnaire(browser);
const problems = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ ...contextOptions(vp), deviceScaleFactor: 1 });
  await installHarness(ctx, config);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${vp.tag} · שגיאת דף: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${vp.tag} · שגיאת קונסול: ${m.text()}`);
  });

  const shot = (name) => page.screenshot({ path: join(OUT, `${vp.tag}-${name}.png`) });

  /** גלישה אופקית היא הכשל הקלאסי של RTL צר — שדה או שורה שלא מתכווצים. */
  const overflow = async (where) => {
    const px = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (px > 0) problems.push(`${vp.tag} · ${where}: גלישה אופקית של ${px}px`);
  };

  // ── השאלון ──
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await shot('survey-intro');
  await page.locator('.btn.primary').first().click(); // מסך פתיחה → הסכמה
  await page.waitForTimeout(250);
  await shot('survey-consent');
  await page.locator('.btn.primary').first().click(); // הסכמה → גיל
  await page.waitForTimeout(250);
  await page.locator('input[type=number]').fill('37');
  await page.locator('.btn.primary').first().click();
  await page.waitForTimeout(300);
  await page.locator('[role=radio]').first().click();
  await page.waitForTimeout(150);
  await shot('survey-single');
  await overflow('שאלון');

  // ── רשימת השאלונים ──
  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('admin-list');
  await overflow('רשימת השאלונים');

  // ── העורך ──
  await page.goto(`${BASE_URL}/admin/mortgage-personas`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot('admin-editor');
  await overflow('עורך');

  // ── מגירת העריכה ──
  await page.locator('.screen-item-body').first().click().catch(() => {});
  await page.waitForTimeout(900);
  await shot('admin-drawer');
  await overflow('מגירת העריכה');

  await ctx.close();
  console.log(`${vp.tag}px ✓`);
}

await browser.close();

if (problems.length) {
  console.error('\nנמצאו בעיות:');
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`\nהכול תקין. צילומים: ${OUT}`);
