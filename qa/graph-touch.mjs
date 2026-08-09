// מחוות מגע בתרשים הזרימה: צביטה להגדלה, צביטה להקטנה, ופאן באצבע אחת.
//
//   node qa/graph-touch.mjs
//
// ⚠ מגבלה: האירועים נשלחים ידנית ו-setPointerCapture מנוטרל, כי אין ל-Playwright
// דרך לשלוח שני מצביעי מגע אמיתיים. הבדיקה מאמתת את הלוגיקה של המחווה, לא את
// התנהגות הדפדפן סביבה — בדיקה במכשיר אמיתי עדיין שווה משהו.

import { chromium } from 'playwright';
import { BASE_URL, contextOptions, installHarness, loadQuestionnaire } from './harness.mjs';

const browser = await chromium.launch();
const config = await loadQuestionnaire(browser);
const ctx = await browser.newContext(contextOptions({ width: 390, height: 844 }));
await installHarness(ctx, config);

const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('שגיאת דף:', e.message));
await page.goto(`${BASE_URL}/admin/mortgage-personas`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('tab', { name: 'תרשים הזרימה' }).click();
await page.waitForTimeout(1400);

const zoom = async () => Number((await page.locator('.fg-zoom').textContent()).replace('%', ''));

/** מזיז שני מצביעים מ-`from` ל-`to` (חצי-מרחק מהמרכז), פריים אחר פריים. */
async function pinch(ids, from, to) {
  await page.evaluate(
    async ([ids, from, to]) => {
      const el = document.querySelector('.fg-canvas');
      el.setPointerCapture = () => {};
      el.releasePointerCapture = () => {};
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const fire = (type, id, x) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === ids[0],
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: cy,
            button: 0,
            buttons: 1,
          }),
        );
      fire('pointerdown', ids[0], cx - from);
      fire('pointerdown', ids[1], cx + from);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const d = from + ((to - from) * i) / steps;
        fire('pointermove', ids[0], cx - d);
        fire('pointermove', ids[1], cx + d);
        await new Promise((res) => requestAnimationFrame(res));
      }
      fire('pointerup', ids[0], cx - to);
      fire('pointerup', ids[1], cx + to);
    },
    [ids, from, to],
  );
  await page.waitForTimeout(400);
}

const failures = [];
const start = await zoom();

await pinch([1, 2], 40, 200);
const out = await zoom();
if (out <= start) failures.push(`צביטה להגדלה לא הגדילה (${start}% → ${out}%)`);

await pinch([3, 4], 200, 40);
const back = await zoom();
if (back >= out) failures.push(`צביטה להקטנה לא הקטינה (${out}% → ${back}%)`);

// פאן באצבע אחת — חייב להמשיך לעבוד אחרי שהוספנו את הצביטה
const before = await page.evaluate(() => document.querySelector('.fg-world').style.transform);
await page.evaluate(async () => {
  const el = document.querySelector('.fg-canvas');
  const r = el.getBoundingClientRect();
  const fire = (type, x, y) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 9,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
      }),
    );
  fire('pointerdown', r.left + 40, r.top + 40);
  for (let i = 1; i <= 6; i++) {
    fire('pointermove', r.left + 40 + i * 12, r.top + 40 + i * 8);
    await new Promise((res) => requestAnimationFrame(res));
  }
  fire('pointerup', r.left + 112, r.top + 88);
});
await page.waitForTimeout(300);
const after = await page.evaluate(() => document.querySelector('.fg-world').style.transform);
if (before === after) failures.push('פאן באצבע אחת לא הזיז את התרשים');

await browser.close();

if (failures.length) {
  console.error('נמצאו בעיות:');
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`הכול תקין — זום ${start}% → ${out}% → ${back}%, ופאן עובד.`);
