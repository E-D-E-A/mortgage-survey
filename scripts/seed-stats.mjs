// נתוני דמו לפיתוח מסך הסטטיסטיקות: שאלון 'demo' עם שתי גרסאות ועשרות סשנים
// סינתטיים — כל התוצאות (השלמה/סינון/מכסה/נטישה/כניסה-בלי-מענה), מסלולים A/B/C,
// מענה חוזר אחרי חזרה אחורה, דילוגים על שאלת טקסט, וסשני בדיקה (?test=1).
// שימוש: npm run db:seed  (דורש `npx supabase start` + סכמה מוחלת: npm run db:schema)
//
// ריצה חוזרת בטוחה: survey_configs הוא append-only (trigger חוסם עדכון/מחיקה),
// ולכן הקונפיגים מוכנסים עם on conflict do nothing; אירועי demo נמחקים ונזרעים
// מחדש כך שאין הצטברות כפולה. מקומי בלבד — מסרבים למארח שאינו מקומי.
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const V1 = '2026-08-01.1-demo';
export const V2 = '2026-08-05.2-demo';

// ─── קונפיגים: מבנה SurveyConfig אמיתי, מצומצם ─────────────────────────────
const optionsV1 = [
  { id: 'active', label: 'יש לי משכנתה פעילה' },
  { id: 'past5', label: 'הייתה לי משכנתה בחמש השנים האחרונות' },
  { id: 'planning', label: 'מתכנן/ת לקחת משכנתה בשנה הקרובה' },
  { id: 'none', label: 'אף אחד מאלה', exclusive: true },
];

const screensCommon = (statusOptions) => [
  { id: 'intro', type: 'info', title: 'ברוכים הבאים', body: 'שאלון דמו לסטטיסטיקות.', cta: 'להתחיל' },
  {
    id: 'consent', type: 'consent', title: 'הסכמה', body: 'ההשתתפות מרצון.',
    agreeLabel: 'אני מסכים/ה', declineLabel: 'לא מעוניין/ת',
    next: [{ if: { q: 'consent', op: 'eq', value: 'declined' }, goto: 'end_screenout' }],
  },
  {
    id: 's_status', type: 'single', prompt: 'מה מצב המשכנתה שלך?', options: statusOptions,
    onSubmit: [
      { var: 'segment', value: 'A', if: { q: 's_status', op: 'in', value: ['active', 'past5'] } },
      { var: 'segment', value: 'B', if: { q: 's_status', op: 'eq', value: 'planning' } },
      { var: 'segment', value: 'C', if: { q: 's_status', op: 'in', value: ['none', 'considering'] } },
    ],
    next: [{ if: { var: 'segment', op: 'eq', value: 'C' }, goto: 'end_screenout' }],
  },
  {
    id: 'goals', type: 'multi', prompt: 'מה חשוב לך במשכנתה?', maxSelections: 3,
    options: [
      { id: 'rate', label: 'ריבית נמוכה' },
      { id: 'monthly', label: 'החזר חודשי נוח' },
      { id: 'flex', label: 'גמישות בפירעון' },
      { id: 'advice', label: 'ליווי מקצועי' },
      { id: 'speed', label: 'אישור מהיר' },
    ],
  },
  {
    id: 'trust', type: 'matrix', prompt: 'עד כמה את/ה סומך/ת על הגורמים הבאים?',
    items: [
      { id: 'bank', label: 'הבנק' },
      { id: 'advisor', label: 'יועץ משכנתאות' },
      { id: 'online', label: 'כלים דיגיטליים' },
    ],
    scaleMin: 1, scaleMax: 5, minLabel: 'כלל לא', maxLabel: 'במידה רבה', naLabel: 'לא רלוונטי',
  },
];

const budgetScreen = {
  id: 'budget', type: 'number', prompt: 'מה התקציב המשוער לדירה?', min: 100000, max: 10000000, unit: '₪', integer: true,
};

const whyScreen = {
  id: 'why', type: 'text', prompt: 'מה הדבר שהכי מדאיג אותך במשכנתה?', multiline: true, optional: true,
};

const endScreens = [
  { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה!', body: 'סיימנו.' },
  { id: 'end_screenout', type: 'end', variant: 'screenout', title: 'תודה', body: 'השאלון לא רלוונטי עבורך.' },
  { id: 'end_quota', type: 'end', variant: 'quotafull', title: 'תודה', body: 'המכסה מלאה.' },
];

const varMeta = {
  segment: {
    label: 'מסלול המשיב',
    values: { A: 'יש או הייתה משכנתה', B: 'לקראת משכנתה', C: 'לא רלוונטי', pending: 'טרם נקבע' },
  },
};

export const CONFIG_V1 = {
  version: V1,
  randomVars: { price: [1200, 1900] },
  varMeta,
  screens: [...screensCommon(optionsV1), budgetScreen, whyScreen, ...endScreens],
};

// v2: אפשרות חדשה ב-s_status, ומסך budget הוסר — כדי שיהיו גם "spans N versions"
// על שאלת הסטטוס וגם מסך שפרש (retired) במשפך המשולב.
export const CONFIG_V2 = {
  version: V2,
  randomVars: { price: [1200, 1900] },
  varMeta,
  screens: [
    ...screensCommon([...optionsV1.slice(0, 3), { id: 'considering', label: 'שוקל/ת, עוד אין החלטה' }, optionsV1[3]]),
    whyScreen,
    ...endScreens,
  ],
};

// ─── RNG דטרמיניסטי — ריצות חוזרות מפיקות את אותם נתונים ────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
}

// הסכמה דורשת UUID תקני — נבנים מזהים דטרמיניסטיים חוקיים ממונה רץ:
let uidCounter = 0;
const hex = (n, len) => n.toString(16).padStart(len, '0').slice(-len);
const sessionUuid = (i) => `5eed0000-0000-4000-8000-${hex(i + 1, 12)}`;
const eventUuid = () => `ee000000-0000-4000-8000-${hex(++uidCounter, 12)}`;

const WHY_TEXTS = [
  'שהריבית תעלה ולא נעמוד בהחזר',
  'הבירוקרטיה מול הבנק',
  'לא מבין את המסלולים בכלל, מרגיש שמוכרים לי משהו שאי אפשר להשוות',
  'ההחזר החודשי',
  'קנסות פירעון מוקדם',
  'שאני משלם יותר מדי ואין לי דרך לדעת',
  'אין לי ביטחון תעסוקתי לעשרים שנה קדימה',
  'עמלות נסתרות',
  'ההצמדה למדד',
  'שאצטרך למחזר בתנאים גרועים',
];

// ─── בניית סשן סינתטי אחד ───────────────────────────────────────────────────
function buildSession(i, plan, rows) {
  const version = plan.version;
  const config = version === V1 ? CONFIG_V1 : CONFIG_V2;
  const sid = sessionUuid(i);
  const startedAt = new Date(Date.UTC(2026, 7, 2, 8, 0, 0) + i * 137 * 60_000 + randInt(0, 3_600_000));
  let t = startedAt.getTime();
  const price = pick([1200, 1900]);
  const startVars = { price, url_source: plan.source };
  if (plan.test) startVars.url_test = '1';

  // payload נשאר אובייקט — postgres.js משדר אובייקט כ-json; מחרוזת מוכנה
  // הייתה נשמרת כמחרוזת-בתוך-jsonb (קידוד כפול) ושוברת כל payload -> 'vars'
  const push = (event_type, screen_id, payload) => {
    rows.push({
      event_uid: eventUuid(),
      session_id: sid,
      survey_version: version,
      event_type,
      screen_id,
      payload,
      client_ts: new Date(t),
      created_at: new Date(t),
    });
  };

  push('session_start', null, { vars: startVars, userAgent: 'seed', language: 'he', viewport: { w: 390, h: 844 } });

  const vars = { ...startVars };
  const answers = {};
  const withVars = (payload) => (plan.oldClient ? payload : { ...payload, vars: { ...vars } });
  const view = (id, index, attempt = 1) => {
    t += randInt(300, 1200);
    push('screen_view', id, { index, attempt });
  };
  const answer = (id, value, attempt = 1, msOverride) => {
    const ms = msOverride ?? randInt(3500, 28000);
    t += ms;
    answers[id] = value;
    push('answer', id, withVars({ value, ms, attempt }));
  };

  const screens = config.screens;
  const idx = (id) => screens.findIndex((s) => s.id === id);

  // intro: צפייה בלבד (מסך info לא מייצר answer)
  view('intro', idx('intro'));
  if (plan.outcome === 'bounced') return; // נכנסו ולא ענו כלל

  t += randInt(2000, 7000);
  view('consent', idx('consent'));
  answer('consent', 'agreed', 1, randInt(2500, 9000));

  view('s_status', idx('s_status'));
  const statusBySegment = {
    A: () => pick(['active', 'past5']),
    B: () => 'planning',
    C: () => (version === V2 ? pick(['none', 'considering']) : 'none'),
  };
  let status = statusBySegment[plan.segment]();

  // מענה חוזר: עונים, חוזרים אחורה ומשנים — attempt 2 הוא הקובע
  if (plan.reanswer) {
    const first = plan.segment === 'A' ? 'planning' : 'active';
    answer('s_status', first, 1);
    view('s_status', idx('s_status'), 2);
    answer('s_status', status, 2, randInt(900, 2600));
  } else {
    answer('s_status', status, 1);
  }
  vars.segment = plan.segment;
  answers.s_status = status;

  if (plan.outcome === 'screenout') {
    t += randInt(400, 1200);
    push('screenout', 'end_screenout', { variant: 'screenout', answers: { ...answers }, vars: { ...vars }, totalMs: t - startedAt.getTime() });
    return;
  }
  if (plan.outcome === 'quotafull') {
    t += randInt(400, 1200);
    push('quotafull', 'end_quota', { variant: 'quotafull', answers: { ...answers }, vars: { ...vars }, totalMs: t - startedAt.getTime() });
    return;
  }

  // goals — רב-ברירה, 1–3 בחירות מוטות לפי מסלול
  view('goals', idx('goals'));
  const goalPool = plan.segment === 'A' ? ['rate', 'flex', 'monthly', 'advice'] : ['monthly', 'advice', 'rate', 'speed'];
  const nGoals = weighted([[1, 2], [2, 5], [3, 3]]);
  answer('goals', [...new Set(Array.from({ length: nGoals }, () => pick(goalPool)))]);

  if (plan.outcome === 'abandoned' && plan.dropAt === 'trust') return;

  // trust — מטריצה 1–5 עם קצת NA
  view('trust', idx('trust'));
  const matrix = {};
  for (const item of ['bank', 'advisor', 'online']) {
    matrix[item] = rnd() < 0.08 ? 'na' : weighted([[1, 1], [2, 2], [3, 4], [4, 5], [5, 3]]);
  }
  answer('trust', matrix);

  if (plan.outcome === 'abandoned') return; // נטישה אחרי trust

  if (version === V1) {
    view('budget', idx('budget'));
    answer('budget', randInt(8, 45) * 50_000);
  }

  view('why', idx('why'));
  const whyValue = rnd() < 0.3 ? null : pick(WHY_TEXTS);
  answer('why', whyValue, 1, randInt(4000, 40000));

  t += randInt(400, 1200);
  push('complete', 'end_complete', { variant: 'complete', answers: { ...answers, why: whyValue }, vars: { ...vars }, totalMs: t - startedAt.getTime() });
}

// ─── תוכנית הזריעה ──────────────────────────────────────────────────────────
function buildPlans() {
  const plans = [];
  const source = () => weighted([['facebook', 4], ['panel', 4], ['whatsapp', 2]]);
  const seg = () => weighted([['A', 5], ['B', 3], ['C', 2]]);
  const add = (n, make) => { for (let k = 0; k < n; k++) plans.push(make(k)); };

  add(30, (k) => ({ outcome: 'complete', segment: weighted([['A', 6], ['B', 4]]), source: source(), reanswer: k < 5 }));
  add(12, () => ({ outcome: 'screenout', segment: 'C', source: source() }));
  add(3, () => ({ outcome: 'quotafull', segment: 'A', source: source() }));
  add(8, (k) => ({ outcome: 'abandoned', segment: seg() === 'C' ? 'B' : 'A', source: source(), dropAt: k % 2 ? 'trust' : 'why', oldClient: k < 4 }));
  add(7, () => ({ outcome: 'bounced', segment: 'A', source: source() }));
  // סשני בדיקה — מסומנים url_test, מוחרגים כברירת מחדל מכל סטטיסטיקה
  add(6, (k) => ({ outcome: k < 3 ? 'complete' : k < 5 ? 'abandoned' : 'screenout', segment: k < 5 ? 'A' : 'C', source: 'internal', test: true, dropAt: 'why' }));

  return plans.map((p, i) => ({ ...p, version: i % 5 < 2 ? V1 : V2 }));
}

// ─── הזריעה עצמה ────────────────────────────────────────────────────────────
export async function seedDemo(sql) {
  await sql`insert into surveys (slug, name, created_by) values ('demo', 'שאלון דמו — סטטיסטיקות', 'seed')
            on conflict (slug) do nothing`;
  // survey_configs הוא append-only (trigger), אבל זריעה חוזרת צריכה replace —
  // ב-DB מקומי חד-פעמי מותר להשבית את ה-trigger בתוך טרנזקציה ולהכניס טרי.
  // sql.json ולא מחרוזת מוכנה — אחרת הקונפיג נשמר כמחרוזת-בתוך-jsonb.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(732913)`;
    await tx`alter table survey_configs disable trigger survey_configs_immutable`;
    await tx`delete from survey_configs where version in (${V1}, ${V2})`;
    for (const config of [CONFIG_V1, CONFIG_V2]) {
      await tx`insert into survey_configs (version, survey_id, config, published_by)
               values (${config.version}, 'demo', ${tx.json(config)}, 'seed')`;
    }
    await tx`alter table survey_configs enable trigger survey_configs_immutable`;
  });

  await sql`delete from survey_events where survey_version in (${V1}, ${V2})`;

  const rows = [];
  buildPlans().forEach((plan, i) => buildSession(i, plan, rows));

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await sql`insert into survey_events ${sql(chunk, 'event_uid', 'session_id', 'survey_version', 'event_type', 'screen_id', 'payload', 'client_ts', 'created_at')}`;
  }
  return rows.length;
}

// CLI: node scripts/seed-stats.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
    console.error('refusing non-local database host');
    process.exit(1);
  }
  const sql = postgres(url, { onnotice: () => {} });
  try {
    const n = await seedDemo(sql);
    console.log(`seeded ${n} events for survey 'demo' (${V1}, ${V2})`);
  } finally {
    await sql.end();
  }
}
