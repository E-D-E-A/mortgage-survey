// Regenerates the screenshots the Confluence guides use.
//
// The guides go stale the moment the console is restyled, and a screenshot
// nobody can regenerate is a screenshot nobody replaces. So this is a script and
// not a folder of images someone once captured by hand.
//
// One shot per feature, and most of them are framed on the panel that owns the
// feature rather than on the whole window: a reader who is looking for "where do
// I set a quota" is helped by the quota dialog filling the frame, and hindered by
// a 1440-pixel desktop with the dialog somewhere in the middle of it.
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
import postgres from 'postgres';

const BASE = 'http://127.0.0.1:8888';
const STATIC = 'http://127.0.0.1:3999';
const API = 'http://127.0.0.1:54321';
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'dev-admin@first-edea.com';
const PASSWORD = 'local-dev-password-1';
const OUT = 'docs/screenshots';
const PRICES = ['79', '149', '249'];

// The young-couple cell is capped at 50 in the demo questionnaire. Filling it for
// real — rather than faking the screen — is what makes the quota-full screenshot
// evidence that the routing works. Removed again at the end of the run.
const QUOTA_FILL = 50;
const FILL_TAG = 'aabb0000-0000-4000-8000-';

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

const sql = postgres(DB, { onnotice: () => {} });
const [{ version: AB_VERSION }] = await sql`
  select version from survey_configs where survey_id = 'ab-demo' order by published_at desc limit 1`;

/**
 * Completed, non-test young-couple sessions — exactly what quota_counts counts.
 *
 * ⚠ created_at is set by hand rather than left to now(). session_stats reads a
 * session's vars from its *latest* event carrying them, and two rows inserted in
 * the same statement share a now(), so with a default timestamp the tie breaks
 * arbitrarily and roughly half the sessions read back as the empty vars of their
 * session_start — a quota that fills to half of what was seeded.
 */
async function fillYoungCoupleQuota() {
  const rows = [];
  for (let i = 0; i < QUOTA_FILL; i++) {
    const session = `${FILL_TAG}${String(i).padStart(12, '0')}`;
    const started = new Date(Date.now() - (QUOTA_FILL - i) * 60_000);
    rows.push(
      { event_uid: `${FILL_TAG}${String(i + 1000).padStart(12, '0')}`, session_id: session,
        survey_version: AB_VERSION, event_type: 'session_start', screen_id: null, payload: { vars: {} },
        created_at: started },
      { event_uid: `${FILL_TAG}${String(i + 2000).padStart(12, '0')}`, session_id: session,
        survey_version: AB_VERSION, event_type: 'complete', screen_id: 'end_complete',
        payload: { vars: { persona: 'young_couple' } },
        created_at: new Date(started.getTime() + 30_000) },
    );
  }
  await sql`insert into survey_events ${sql(rows, 'event_uid', 'session_id', 'survey_version', 'event_type', 'screen_id', 'payload', 'created_at')}
            on conflict (event_uid) do nothing`;
  const [cell] = await sql`select n from quota_counts('ab-demo', array['persona']) where value = 'young_couple'`;
  if (!cell || cell.n < QUOTA_FILL) throw new Error(`quota only filled to ${cell?.n ?? 0}/${QUOTA_FILL}`);
}

const clearQuotaFill = () => sql`delete from survey_events where session_id::text like ${FILL_TAG + '%'}`;

const token = await adminSession();
const browser = await chromium.launch();
const taken = [];
/** `target` is a page for a whole window, or a locator to frame one panel. */
const shot = async (target, name, opts = {}) => {
  await target.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  taken.push(name);
  console.log('  ✓', name);
};

// ── signing in ─────────────────────────────────────────────────────────────
console.log('sign-in:');
const anon = await browser.newContext({ viewport: { width: 1100, height: 720 }, locale: 'he-IL' });
await routeAssets(anon);
const guest = await anon.newPage();
await guest.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await guest.waitForSelector('.login-card', { timeout: 15000 });
await shot(guest, '01-login');
await anon.close();

// ── the console ────────────────────────────────────────────────────────────
const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
await routeAssets(admin);
await admin.addInitScript(([k, v]) => localStorage.setItem(k, v), [
  'sb-127-auth-token', JSON.stringify(token),
]);
const page = await admin.newPage();
page.on('dialog', (d) => void d.accept());

console.log('console:');
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot(page, '02-survey-list');

await page.goto(`${BASE}/admin/ab-demo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await shot(page, '03-editor-overview');

// The diagram auto-fits to the window, so on a laptop-shaped viewport a
// thirteen-screen survey lands at 41% and no node is readable. A tall window and
// a re-fit buy the zoom back without cropping the flow.
await page.setViewportSize({ width: 1440, height: 1700 });
await page.getByRole('button', { name: 'הצגת כל התרשים' }).click();
await page.waitForTimeout(900);
await shot(page.locator('.flow-graph'), '04-flow-graph');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(500);

/** Opens one screen in the drawer and returns the section with that heading. */
async function openSection(screenName, sectionTitle) {
  await page.locator('.screen-item-body', { hasText: screenName }).first().click();
  await page.waitForTimeout(700);
  return page.locator('section.ed-section', { hasText: sectionTitle }).first();
}

await shot(await openSection('מה מתאר את מצבך היום?', 'תוכן המסך'), '05-screen-content');
await shot(page.locator('section.ed-section', { hasText: 'סימון המשיב' }).first(), '06-set-var');
await shot(await openSection('מתי לדעתך תגישו בקשה למשכנתה?', 'מי רואה את המסך'), '07-show-if');
await shot(await openSection('הסכמה להשתתפות', 'לאן ממשיכים מכאן'), '08-routing');
await shot(page.locator('aside.editor-drawer'), '09-screen-drawer');

// The dialogs are taller than a laptop viewport and scroll inside themselves, so
// a locator shot of one comes out cropped. Giving the window the height instead
// keeps the whole dialog — draws, then every quota cell — in a single frame.
await page.setViewportSize({ width: 1440, height: 1500 });
await page.getByRole('button', { name: 'משתנים ומכסות' }).click();
await page.waitForTimeout(900);
await shot(page.locator('[role="dialog"][aria-label="משתנים ומכסות"]'), '10-vars-and-quotas');
await page.getByRole('button', { name: 'סגירה' }).first().click();
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'בדיקת מסלול' }).click();
await page.waitForTimeout(900);
await shot(page.locator('aside.simulator'), '11-path-check');
await page.getByRole('button', { name: 'סגירת בדיקת המסלול' }).click();
await page.waitForTimeout(400);

// Validation, shown the only way it is worth showing — with something actually
// wrong. Deleting the quota-full screen while quotas exist is the mistake the
// rule was written for. The draft is never saved, and the reload throws it away.
console.log('validation:');
await page.locator('.screen-item-body', { hasText: 'תודה, כבר סיימנו לאסוף' }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'מחיקת המסך' }).first().click();
await page.waitForTimeout(900);
// Clipped to the top of the window rather than to the panel itself: on its own
// the bar is a sliver of red text with nothing to say where it appears, and the
// point of the shot is that it sits under the toolbar, next to the publish button.
await shot(page, '12-validation', { clip: { x: 0, y: 0, width: 1440, height: 210 } });
await page.goto(`${BASE}/admin/ab-demo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

await page.getByRole('button', { name: 'פרסום' }).click();
await page.waitForTimeout(900);
await shot(page.locator('[role="dialog"][aria-label="פרסום גרסה"]'), '13-publish');
await page.getByRole('button', { name: 'סגירה' }).first().click();

console.log('statistics:');
await page.goto(`${BASE}/admin/demo/stats`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
// One viewport at 1440x900 already holds the tiles, the funnel and the first
// distribution cards. fullPage is deliberately not used: this layout scrolls an
// inner container rather than the window, and a fullPage capture comes out blank.
await shot(page, '14-stats-overview');
await shot(page.locator('.stats-controls').first(), '15-stats-controls');
await shot(page.locator('section[aria-label="סקירה כללית"]'), '16-stats-tiles');
await shot(page.locator('section[aria-label="משפך פר-מסך"]'), '17-stats-funnel');
await shot(page.locator('section[aria-label="התפלגויות תשובות"]'), '18-stats-distributions');

await page.getByRole('combobox', { name: /פילוח/ }).first().selectOption({ index: 1 });
await page.waitForTimeout(2000);
await shot(page.locator('section[aria-label="התפלגויות תשובות"]'), '19-stats-breakdown');

await page.getByRole('tab', { name: 'תשובות פתוחות' }).click();
await page.waitForTimeout(1800);
await shot(page.locator('section[aria-label="תשובות פתוחות"]'), '20-open-answers');
await admin.close();

// ── the respondent ─────────────────────────────────────────────────────────
console.log('respondent:');
const phone = async () => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'he-IL', isMobile: true, hasTouch: true,
  });
  await routeAssets(ctx);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/s/ab-demo?test=1`, { waitUntil: 'networkidle' });
  await p.waitForSelector('main.card', { timeout: 15000 });
  await p.waitForTimeout(600);
  return { ctx, p };
};
const cardText = (p) => p.locator('main.card').innerText();
const tap = async (p, name) => {
  await p.getByRole('button', { name }).first().click();
  await p.waitForTimeout(500);
};
const answer = async (p, label) => {
  await p.getByRole('radio', { name: label }).first().click();
  await p.waitForTimeout(200);
};

// A respondent whose cell is open: intro → question → the drawn price → thanks
{
  const { ctx, p } = await phone();
  await shot(p, '21-respondent-intro');
  await tap(p, 'מתחילים');
  await tap(p, 'אני מסכים/ה');
  await p.locator('input[type="number"]').first().fill('34');
  await tap(p, 'המשך');
  await shot(p, '22-respondent-question');
  await answer(p, /רק מתעניין/);          // browsing — an uncapped cell
  await tap(p, 'המשך');

  let reached = false;
  for (let step = 0; step < 14 && !reached; step++) {
    const text = await cardText(p);
    if (text.includes('עולה') && PRICES.some((x) => text.includes(x))) { reached = true; break; }
    const radios = p.locator('[role="radio"]');
    if (await radios.count()) await radios.first().click();
    const txt = p.locator('textarea, input[type="text"]');
    if (await txt.count()) await txt.first().fill('הריבית מדאיגה אותי');
    const go = p.getByRole('button', { name: /המשך|מתחילים|דילוג/ }).first();
    if (!(await go.count())) break;
    await go.click();
    await p.waitForTimeout(450);
  }
  if (!reached) throw new Error('never reached the A/B price screen — has the demo questionnaire changed?');
  await shot(p, '23-respondent-ab-price');

  for (let step = 0; step < 14; step++) {
    if ((await cardText(p)).includes('תודה')) break;
    const radios = p.locator('[role="radio"]');
    if (await radios.count()) await radios.first().click();
    const txt = p.locator('textarea, input[type="text"]');
    if (await txt.count()) await txt.first().fill('רוצה להבין כמה זה חוסך בפועל');
    const go = p.getByRole('button', { name: /המשך|דילוג/ }).first();
    if (!(await go.count())) break;
    await go.click();
    await p.waitForTimeout(450);
  }
  await shot(p, '24-respondent-complete');
  await ctx.close();
}

// Declining consent — the screen-out ending, which is not the quota ending
{
  const { ctx, p } = await phone();
  await tap(p, 'מתחילים');
  await tap(p, 'לא מעוניין/ת');
  await shot(p, '25-respondent-screenout');
  await ctx.close();
}

// A respondent whose cell is full. The 50 completes are real rows, so this is the
// live routing rule firing and not a mock.
// The seeded completes are removed even when the walk fails, so a broken run
// never leaves the demo survey with a quota that is mysteriously full.
try {
  console.log(`  filling the young-couple quota (${QUOTA_FILL} completes)…`);
  await fillYoungCoupleQuota();
  const { ctx, p } = await phone();
  await tap(p, 'מתחילים');
  await tap(p, 'אני מסכים/ה');
  await p.locator('input[type="number"]').first().fill('29');
  await tap(p, 'המשך');
  await answer(p, /מתכנן/);               // young_couple — the full cell
  await tap(p, 'המשך');
  const text = await cardText(p);
  if (!text.includes('מספיק')) throw new Error(`expected the quota-full ending, got: ${text.slice(0, 80)}`);
  await shot(p, '26-respondent-quotafull');
  await ctx.close();
} finally {
  await clearQuotaFill();
}

await browser.close();
await sql.end();
console.log(`\n${taken.length} screenshots in ${OUT}/`);
