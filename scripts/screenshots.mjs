// Regenerates the screenshots the Confluence guides use.
//
// The guides go stale the moment the console is restyled, and a screenshot
// nobody can regenerate is a screenshot nobody replaces. So this is a script and
// not a folder of images someone once captured by hand.
//
// Before running:
//   npx supabase start
//   npm run db:schema && npm run db:seed        # the 'demo' survey and its sessions
//   npx vite-node scripts/seed-ab-demo.ts       # the worked A/B + quotas survey
//   npx netlify serve                           # production build + functions on 8888
// Then:
//   node scripts/screenshots.mjs
//
// Why `netlify serve` and not `netlify dev`: in a dev build the respondent app
// deliberately ignores the database and serves the local questionnaire file, so
// no draw ever happens and the A/B screenshots would show the wrong survey.
//
// ⚠ The netlify CLI's proxy has been seen to 403 /assets/* on Windows while its
// own static server serves them fine. The asset route below works around that
// without moving the page off :8888, which is what keeps the functions reachable.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8888';
const STATIC = 'http://127.0.0.1:3999';
const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'dev-admin@first-edea.com';
const PASSWORD = 'local-dev-password-1';
const OUT = 'docs/screenshots';
const PRICES = ['79', '149', '249'];

mkdirSync(OUT, { recursive: true });

async function adminSession() {
  await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: EMAIL, password: PASSWORD, email_confirm: true,
      app_metadata: { provider: 'google', providers: ['google'] },
    }),
  });
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed (${res.status}) — is the local stack up?`);
  return res.json();
}

/** Assets come from the static server; everything else keeps the :8888 origin. */
async function routeAssets(ctx) {
  await ctx.route('**/assets/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const res = await fetch(STATIC + pathname);
    route.fulfill({
      status: res.status,
      body: Buffer.from(await res.arrayBuffer()),
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
    });
  });
}

const token = await adminSession();
const browser = await chromium.launch();
const taken = [];
const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  taken.push(name);
  console.log('  ✓', name);
};

// ── the console ────────────────────────────────────────────────────────────
const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
await routeAssets(admin);
await admin.addInitScript(([k, v]) => localStorage.setItem(k, v), [
  'sb-127-auth-token', JSON.stringify(token),
]);
const page = await admin.newPage();

console.log('console:');
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot(page, '01-survey-list');

await page.goto(`${BASE}/admin/ab-demo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await shot(page, '02-editor');

await page.getByRole('button', { name: 'משתנים ומכסות' }).click();
await page.waitForTimeout(900);
await shot(page, '03-vars-and-quotas');
await page.getByRole('button', { name: 'סגירה' }).first().click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'בדיקת מסלול' }).click();
await page.waitForTimeout(900);
await shot(page, '04-simulator');

console.log('statistics:');
await page.goto(`${BASE}/admin/demo/stats`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
// One viewport at 1440x900 already holds the tiles, the funnel and the first
// distribution cards. fullPage is deliberately not used: this layout scrolls an
// inner container rather than the window, and a fullPage capture comes out blank.
await shot(page, '05-stats-overview');
await page.getByRole('tab', { name: 'תשובות פתוחות' }).click();
await page.waitForTimeout(1800);
await shot(page, '08-open-answers');

// ── the respondent ─────────────────────────────────────────────────────────
console.log('respondent:');
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 }, locale: 'he-IL', isMobile: true, hasTouch: true,
});
await routeAssets(mobile);
const r = await mobile.newPage();
await r.goto(`${BASE}/s/ab-demo?test=1`, { waitUntil: 'networkidle' });
await r.waitForSelector('main.card', { timeout: 15000 });
await r.waitForTimeout(600);
await shot(r, '09-respondent-intro');

// Walk in until the screen the drawn price is written into
let reached = false;
for (let step = 0; step < 14 && !reached; step++) {
  const text = await r.locator('main.card').innerText();
  if (text.includes('עולה') && PRICES.some((x) => text.includes(x))) { reached = true; break; }
  const radios = r.locator('[role="radio"]');
  if (await radios.count()) await radios.first().click();
  const num = r.locator('input[type="number"]');
  if (await num.count()) await num.first().fill('34');
  const txt = r.locator('textarea, input[type="text"]');
  if (await txt.count()) await txt.first().fill('הריבית מדאיגה אותי');
  const go = r.getByRole('button', { name: /המשך|מתחילים|אני מסכים|דילוג/ }).first();
  if (!(await go.count())) break;
  await go.click();
  await r.waitForTimeout(450);
}
if (!reached) throw new Error('never reached the A/B price screen — has the demo questionnaire changed?');
await shot(r, '10-respondent-ab-price');

await browser.close();
console.log(`\n${taken.length} screenshots in ${OUT}/`);
