// @vitest-environment jsdom
//
// הצינור המלא, מקצה לקצה: משיב אמיתי לוחץ על המסכים האמיתיים (React, DOM),
// והשורות שיוצאות ברשת נבדקות אחת-אחת — סוג האירוע, סדרו, מבנה ה-payload,
// והמעבר בשער האמיתי של ה-Netlify Function (sanitizeRow מ-lib/event-schema).
//
// למה זה נכתב ככה ולא כבדיקת יחידה של submit(): מה שמעניין הוא לא "האם
// הפונקציה מייצרת אובייקט", אלא **מה באמת יגיע ל-survey_events** כשמשיב
// ילחץ על תוויות בעברית. לכן כל בחירה נעשית לפי *הנוסח שהמשיב רואה*
// והבדיקה מאמתת שמה שנשמר הוא ה-**מזהה** (קוד האנליזה, docs/codebook.md).
//
// ⚠ הבדיקה כאן מכסה גם את מה ש-views ב-schema.sql נשענים עליו:
//   screen_funnel קורא payload->>'ms' בשורות answer, ו-completed_responses
//   קורא את payload של שורת הסיום (answers / vars). מפתח חסר שם = view ריק.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { sanitizeRow, type EventRow } from '../../netlify/functions/lib/event-schema';
import { evaluate } from '../engine/conditions';
import { findNext } from '../engine/navigation';
import type {
  AnswerValue,
  MatrixAnswer,
  Screen,
  SurveyConfig,
  SurveyContext,
} from '../engine/types';
import { questionnaire } from '../questionnaire/survey-v1';

// ────────────────────────────── רתמה ──────────────────────────────

/** כל השורות שהצליחו להגיע לשרת, בסדר ההגעה. */
let delivered: EventRow[] = [];
/** כל ניסיון שליחה, כולל אצוות שנדחו — כדי לבדוק שה-retry שולח את אותם uid. */
let attempts: EventRow[][] = [];
/** תשובות שהשרת ייתן, בתור. מה שנגמר — 204. */
let statuses: number[] = [];

let uuidCounter = 0;
let App: typeof import('../App').default;

const QUEUE_KEY = 'sq_queue_v1';

beforeAll(async () => {
  // eventsEnabled נקבע פעם אחת בזמן טעינת המודול, ולכן ה-stub חייב להיות
  // לפני הייבוא הראשון של events.ts — ומכאן הייבוא הדינמי.
  vi.stubEnv('PROD', true);

  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => {
      uuidCounter++;
      const hex = uuidCounter.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}` as `${string}-${string}-${string}-${string}-${string}`;
    },
  });

  window.scrollTo = vi.fn();

  globalThis.fetch = vi.fn(async (_url: unknown, init?: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as EventRow[];
    attempts.push(body);
    const status = statuses.length > 0 ? statuses.shift()! : 204;
    if (status >= 200 && status < 300) delivered.push(...body);
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as unknown as typeof fetch;

  ({ default: App } = await import('../App'));
  const events = await import('./events');
  // בלי זה כל הבדיקה הזאת הייתה "עוברת" בלי לשלוח שורה אחת
  expect(events.eventsEnabled, 'PROD stub did not reach import.meta.env').toBe(true);
});

beforeEach(() => {
  delivered = [];
  attempts = [];
  statuses = [];
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(async () => {
  cleanup();
  await drain();
});

/** ממתין שהתור המקומי יתרוקן (flush עצמו מתוזמן ב-250/5000ms). */
async function drain(maxMs = 4000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 25));
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw || raw === '[]') return;
  }
}

function queueLength(): number {
  return (JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as unknown[]).length;
}

// ─────────────────────── נהיגה במסכים האמיתיים ───────────────────────

type Plan = Record<string, AnswerValue>;

/** הכותרת שהמשיב רואה במסך — אותו שדה שהקונסולה מציגה בצומת בתרשים. */
function headingOf(s: Screen): string {
  return s.type === 'info' || s.type === 'consent' || s.type === 'end' ? s.title : s.prompt;
}

/**
 * השם הנגיש של תא בסולם המטריצה. משוכפל מ-components/inputs.tsx בכוונה:
 * קצות הסולם *חייבים* לשאת את המשמעות ("1 — כלל לא"), אחרת קורא מסך שומע
 * מספר בלי הקשר. שכפול כאן הופך את זה לחוזה שנבדק ולא למימוש מקומי.
 */
function cellName(s: Extract<Screen, { type: 'matrix' }>, v: number | 'na'): string {
  if (v === 'na') return s.naLabel as string;
  if (v === s.scaleMin) return `${v} — ${s.minLabel}`;
  if (v === s.scaleMax) return `${v} — ${s.maxLabel}`;
  return String(v);
}

/** ברירת מחדל לתשובה, כשה-plan לא קבע — כך אין צורך לרשום 45 תשובות ביד. */
function defaultAnswer(s: Screen): AnswerValue | undefined {
  switch (s.type) {
    case 'consent':
      return 'agreed';
    case 'single':
      return s.options[0].id;
    case 'multi':
      return [s.options[0].id];
    case 'matrix': {
      const mid = Math.min(s.scaleMin + 1, s.scaleMax);
      const answer: MatrixAnswer = {};
      s.items.forEach((item, i) => {
        // פריט אחד מקבל "לא רלוונטי" כשהעמודה קיימת — זה ערך אחר בסוג
        // (‎'na'‎ ולא מספר), ובקידוד הוא ‎.n‎ ולא 0 (docs/codebook.md)
        answer[item.id] = s.naLabel && i === s.items.length - 1 ? 'na' : mid;
      });
      return answer;
    }
    case 'number':
      return s.min ?? 1;
    case 'text':
      return s.optional ? null : 'תשובת בדיקה';
    default:
      return undefined;
  }
}

/**
 * מריץ משיב אמיתי על הקונפיג. הניווט הצפוי מחושב במנוע (findNext) ומאומת מול
 * ה-DOM בכל צעד: אם המנוע אומר "המסך הבא הוא X" והמשיב רואה Y — הבדיקה נופלת.
 * זו החוליה שמחברת את דרישה 1 לדרישה 2.
 */
function runner(config: SurveyConfig, plan: Plan = {}) {
  const user: UserEvent = userEvent.setup();
  const ctx: SurveyContext = { answers: {}, vars: {} };
  const answered: Plan = {};
  const visited: string[] = [];
  let current: Screen | null = config.screens[0];
  const history: Screen[] = [];

  function expectHeading(s: Screen) {
    const heading = screen.getByRole('heading').textContent ?? '';
    const raw = headingOf(s);
    if (raw.includes('{')) {
      // אינטרפולציה: הערך המוגרל חייב להיכנס, ושום סוגר לא נשאר על המסך
      expect(heading).not.toContain('{');
      const pattern = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+');
      expect(heading, `screen "${s.id}" heading`).toMatch(new RegExp(`^${pattern}$`));
    } else {
      expect(heading, `screen "${s.id}" shows the configured wording`).toBe(raw);
    }
  }

  async function answer(s: Screen): Promise<AnswerValue | undefined> {
    const value = s.id in plan ? plan[s.id] : defaultAnswer(s);
    const go = (name: string) => user.click(screen.getByRole('button', { name }));

    switch (s.type) {
      case 'info':
        await go(s.cta ?? 'המשך');
        return undefined;
      case 'consent':
        await go(value === 'declined' ? s.declineLabel : s.agreeLabel);
        return value;
      case 'single': {
        const option = s.options.find((o) => o.id === value)!;
        await user.click(screen.getByRole('radio', { name: option.label }));
        await go('המשך');
        return value;
      }
      case 'multi': {
        for (const id of value as string[]) {
          const option = s.options.find((o) => o.id === id)!;
          await user.click(screen.getByRole('checkbox', { name: option.label }));
        }
        await go('המשך');
        return value;
      }
      case 'matrix': {
        for (const [itemId, cell] of Object.entries(value as MatrixAnswer)) {
          const group = document.querySelector<HTMLElement>(
            `[aria-labelledby="${s.id}-${itemId}"]`,
          )!;
          await user.click(within(group).getByRole('radio', { name: cellName(s, cell) }));
        }
        await go('המשך');
        return value;
      }
      case 'number': {
        await user.type(screen.getByRole('spinbutton'), String(value));
        await go('המשך');
        return value;
      }
      case 'text': {
        if (value === null) {
          await go('דילוג');
          return null;
        }
        await user.type(screen.getByRole('textbox'), String(value));
        await go('המשך');
        return value;
      }
      case 'end':
        return undefined;
    }
  }

  return {
    get current() {
      return current;
    },
    get answered() {
      return answered;
    },
    get visited() {
      return visited;
    },
    get vars() {
      return { ...ctx.vars };
    },

    /** צעד אחד: מאמת את המסך המוצג, עונה, ומעדכן את המצב הצפוי. */
    async step(): Promise<void> {
      const s = current!;
      visited.push(s.id);
      expectHeading(s);
      const value = await answer(s);
      if (s.type === 'end') return;
      if (value !== undefined) {
        ctx.answers[s.id] = value;
        answered[s.id] = value;
      }
      for (const rule of s.onSubmit ?? []) {
        if (!rule.if || evaluate(rule.if, ctx)) ctx.vars[rule.var] = rule.value;
      }
      history.push(s);
      current = findNext(config, s, ctx);
    },

    /** מריץ עד מסך סיום (או עד מסך מסוים, כדי להתערב באמצע). */
    async run(stopAt?: string): Promise<void> {
      for (let guard = 0; guard < 200; guard++) {
        if (!current) return;
        if (stopAt && current.id === stopAt) return;
        const isEnd = current.type === 'end';
        await this.step();
        if (isEnd) return;
      }
      throw new Error('routing loop: 200 screens');
    },

    /** לחיצה על "חזרה" בסרגל — התנועה הטבעית במובייל. */
    async back(): Promise<void> {
      await user.click(screen.getByRole('button', { name: 'חזרה לשאלה הקודמת' }));
      const previous = history.pop();
      if (previous) current = previous;
      visited.push(current!.id);
    },

    /** מענה חוזר לאותו מסך אחרי חזרה אחורה. */
    async reanswer(value: AnswerValue): Promise<void> {
      const s = current!;
      plan[s.id] = value;
      await this.step();
    },
  };
}

// ────────────────────────── טענות על השורות ──────────────────────────

const isQuestion = (s: Screen) => s.type !== 'info' && s.type !== 'end' && s.type !== 'consent';
const screenOf = (config: SurveyConfig, id: string | null) =>
  config.screens.find((s) => s.id === id);

/**
 * כל מה שחייב להיות נכון בכל שורה שנשמרת, בכל מסלול. אם משהו כאן נשבר,
 * הנתונים ב-survey_events שבורים — בלי קשר לשאלון המסוים.
 */
function expectWellFormed(rows: EventRow[], config: SurveyConfig) {
  expect(rows.length).toBeGreaterThan(0);

  // 1. השרת מקבל את השורה כמות שהיא, בלי שדה שנופל בדרך
  for (const row of rows) {
    const clean = sanitizeRow(row);
    expect(clean, `server rejected a row the client produced: ${JSON.stringify(row)}`).not.toBeNull();
    expect(clean).toEqual(row);
  }

  // 2. זהות: uid ייחודי (חוסם כפילות ב-DB), סשן אחד, גרסה אחת
  const uids = rows.map((r) => r.event_uid);
  expect(new Set(uids).size, 'duplicate event_uid').toBe(uids.length);
  expect(new Set(rows.map((r) => r.session_id)).size).toBe(1);
  expect(new Set(rows.map((r) => r.survey_version))).toEqual(new Set([config.version]));
  for (const row of rows) expect(Number.isNaN(Date.parse(row.client_ts))).toBe(false);

  // 3. פתיחת סשן — פעם אחת, ראשונה, עם הפאראדאטה
  const starts = rows.filter((r) => r.event_type === 'session_start');
  expect(starts).toHaveLength(1);
  expect(rows[0].event_type).toBe('session_start');
  expect(starts[0].screen_id).toBeNull();
  for (const key of ['vars', 'userAgent', 'language', 'viewport', 'referrer']) {
    expect(starts[0].payload, `session_start payload.${key}`).toHaveProperty(key);
  }

  // 4. צפיות מסך — רק למסכים שקיימים, עם האינדקס הנכון
  for (const row of rows.filter((r) => r.event_type === 'screen_view')) {
    const s = screenOf(config, row.screen_id);
    expect(s, `screen_view for unknown screen "${row.screen_id}"`).toBeDefined();
    expect(s!.type).not.toBe('end');
    expect(row.payload.index).toBe(config.screens.findIndex((x) => x.id === row.screen_id));
    expect(row.payload.attempt).toBeGreaterThanOrEqual(1);
  }

  // 5. תשובות — הערך תואם את סוג המסך, וה-ms קיים (screen_funnel נשען עליו)
  for (const row of rows.filter((r) => r.event_type === 'answer')) {
    const s = screenOf(config, row.screen_id)!;
    expect(s, `answer for unknown screen "${row.screen_id}"`).toBeDefined();
    expect(typeof row.payload.ms, `answer(${s.id}).ms`).toBe('number');
    expect(row.payload.ms as number).toBeGreaterThanOrEqual(0);
    expect(row.payload.attempt as number).toBeGreaterThanOrEqual(1);
    expectAnswerShape(s, row.payload.value, row.payload);
  }

  // 6. סיום — פעם אחת, אחרון, עם צילום התשובות והמשתנים
  const ends = rows.filter((r) => ['complete', 'screenout', 'quotafull'].includes(r.event_type));
  expect(ends).toHaveLength(1);
  expect(rows.at(-1)).toBe(ends[0]);
  const endScreen = screenOf(config, ends[0].screen_id);
  expect(endScreen?.type).toBe('end');
  expect(ends[0].event_type).toBe((endScreen as Extract<Screen, { type: 'end' }>).variant);
  expect(ends[0].payload.variant).toBe(ends[0].event_type);
  expect(ends[0].payload.answers).toBeTypeOf('object');
  expect(ends[0].payload.vars).toBeTypeOf('object');
  expect(typeof ends[0].payload.totalMs).toBe('number');
}

/** הערך שנשמר חייב להתאים לסוג המסך ולאפשרויות שלו — אחרת הקידוד לא ניתן לפענוח. */
function expectAnswerShape(s: Screen, value: unknown, payload: Record<string, unknown>) {
  switch (s.type) {
    case 'consent':
      expect(['agreed', 'declined']).toContain(value);
      expect(typeof payload.hp, `${s.id}.hp (honeypot)`).toBe('boolean');
      break;
    case 'single': {
      const ids = s.options.map((o) => o.id);
      expect(ids, `${s.id} answered with an option that does not exist`).toContain(value);
      expect(payload.order, `${s.id}.order`).toEqual(expect.arrayContaining(ids));
      expect((payload.order as string[]).length).toBe(ids.length);
      break;
    }
    case 'multi': {
      const ids = s.options.map((o) => o.id);
      expect(Array.isArray(value)).toBe(true);
      for (const v of value as string[]) expect(ids).toContain(v);
      expect(new Set(value as string[]).size).toBe((value as string[]).length);
      if (s.maxSelections !== undefined) {
        expect((value as string[]).length).toBeLessThanOrEqual(s.maxSelections);
      }
      const exclusive = s.options.filter((o) => o.exclusive).map((o) => o.id);
      if ((value as string[]).some((v) => exclusive.includes(v))) {
        expect((value as string[]).length, `${s.id}: exclusive answer must stand alone`).toBe(1);
      }
      expect((payload.order as string[]).length).toBe(ids.length);
      break;
    }
    case 'matrix': {
      const ids = s.items.map((i) => i.id);
      const answer = value as MatrixAnswer;
      expect(Object.keys(answer).sort()).toEqual([...ids].sort());
      for (const [item, cell] of Object.entries(answer)) {
        if (cell === 'na') {
          expect(s.naLabel, `${s.id}.${item} answered 'na' without an na column`).toBeDefined();
        } else {
          expect(Number.isInteger(cell)).toBe(true);
          expect(cell).toBeGreaterThanOrEqual(s.scaleMin);
          expect(cell).toBeLessThanOrEqual(s.scaleMax);
        }
      }
      expect((payload.order as string[]).length).toBe(ids.length);
      break;
    }
    case 'number':
      expect(typeof value).toBe('number');
      if (s.integer) expect(Number.isInteger(value)).toBe(true);
      if (s.min !== undefined) expect(value as number).toBeGreaterThanOrEqual(s.min);
      if (s.max !== undefined) expect(value as number).toBeLessThanOrEqual(s.max);
      break;
    case 'text':
      if (value !== null) expect(typeof value).toBe('string');
      break;
    default:
      break;
  }
}

const finalRow = (rows: EventRow[]) =>
  rows.find((r) => ['complete', 'screenout', 'quotafull'].includes(r.event_type))!;

// ──────────────────────────── הבדיקות ────────────────────────────

const CONSENTED: Plan = { consent: 'agreed', s_age: 35 };

const SEGMENTS: Record<'A' | 'B' | 'C', Plan> = {
  A: { ...CONSENTED, s_status: 'active' },
  B: { ...CONSENTED, s_status: 'none', s_timeline: 'm4_6', s_actions: ['bank'] },
  C: { ...CONSENTED, s_status: 'none', s_timeline: 'later', s_actions: ['none'] },
};

describe('a full response reaches the database intact', () => {
  it.each(['A', 'B', 'C'] as const)(
    'segment %s: every screen, every answer, one terminal row',
    async (segment) => {
      const run = runner(questionnaire, { ...SEGMENTS[segment] });
      render(<App config={questionnaire} />);
      await run.run();
      await drain();

      expectWellFormed(delivered, questionnaire);

      // כל מסך שנראה קיבל screen_view אחד; כל מסך שנענה קיבל answer אחד
      const viewed = delivered.filter((r) => r.event_type === 'screen_view').map((r) => r.screen_id);
      const nonEnd = run.visited.filter((id) => screenOf(questionnaire, id)!.type !== 'end');
      expect(viewed).toEqual(nonEnd);

      const answers = delivered.filter((r) => r.event_type === 'answer');
      expect(answers.map((r) => r.screen_id)).toEqual(Object.keys(run.answered));
      for (const row of answers) {
        expect(row.payload.value, `answer stored for ${row.screen_id}`).toEqual(
          run.answered[row.screen_id!],
        );
      }

      // התקציב: 15 שאלות למשיב, לא 14 ולא 16 (docs/codebook.md §1)
      const questions = answers.filter((r) => isQuestion(screenOf(questionnaire, r.screen_id)!));
      expect(questions).toHaveLength(15);

      // צילום הסיום = בדיוק מה שנענה, ובאותם ערכים
      const end = finalRow(delivered);
      expect(end.event_type).toBe('complete');
      expect(end.payload.answers).toEqual(run.answered);
      expect((end.payload.vars as Record<string, unknown>).segment).toBe(segment);
      expect(end.screen_id).toBe('end_complete');
    },
    30_000,
  );

  it('records the URL parameters the link carried', async () => {
    window.history.replaceState({}, '', '/?source=whatsapp&pid=42');
    const run = runner(questionnaire, { ...SEGMENTS.C });
    render(<App config={questionnaire} />);
    await run.run();
    await drain();

    const vars = (delivered[0].payload as { vars: Record<string, unknown> }).vars;
    expect(vars.url_source).toBe('whatsapp');
    expect(vars.url_pid).toBe('42');
    // הם נשמרים גם בצילום הסיום, שם הניתוח קורא אותם
    expect((finalRow(delivered).payload.vars as Record<string, unknown>).url_source).toBe(
      'whatsapp',
    );
  });
});

describe('screenouts are stored as screenouts, with the answers given so far', () => {
  it('declining consent ends the session immediately', async () => {
    const run = runner(questionnaire, { consent: 'declined' });
    render(<App config={questionnaire} />);
    await run.run();
    await drain();

    expectWellFormed(delivered, questionnaire);
    const end = finalRow(delivered);
    expect(end.event_type).toBe('screenout');
    expect(end.payload.answers).toEqual({ consent: 'declined' });
    expect(delivered.some((r) => r.screen_id === 's_age')).toBe(false);
  });

  it('under 18 is screened out after the age answer', async () => {
    const run = runner(questionnaire, { consent: 'agreed', s_age: 17 });
    render(<App config={questionnaire} />);
    await run.run();
    await drain();

    expectWellFormed(delivered, questionnaire);
    const end = finalRow(delivered);
    expect(end.event_type).toBe('screenout');
    expect(end.payload.answers).toEqual({ consent: 'agreed', s_age: 17 });
    expect(delivered.some((r) => r.screen_id === 's_status')).toBe(false);
  });
});

describe('going back and changing a routing answer', () => {
  it('drops the abandoned track from the final payload', async () => {
    const run = runner(questionnaire, { ...SEGMENTS.B });
    render(<App config={questionnaire} />);
    await run.run('b_deal_type');

    // רענון באמצע — גם מוודא שהמצב משוחזר, וגם מעקר את תלות ה-history של
    // הדפדפן: אחרי הרכבה מחדש "חזרה" עובדת דרך המצב הפנימי בלבד
    cleanup();
    render(<App config={questionnaire} />);

    await run.back(); // s_actions
    await run.back(); // s_timeline
    await run.back(); // s_status
    expect(run.current!.id).toBe('s_status');

    await run.reanswer('active'); // ⇒ מסלול A
    await run.run();
    await drain();

    expectWellFormed(delivered, questionnaire);
    const end = finalRow(delivered);
    const answers = end.payload.answers as Plan;

    expect(end.event_type).toBe('complete');
    expect((end.payload.vars as Record<string, unknown>).segment).toBe('A');
    // המקטע הנטוש נגזם: תשובות B ושאלות הסינון של B/C אינן חלק מהתשובה
    expect(Object.keys(answers).filter((id) => id.startsWith('b_'))).toEqual([]);
    expect(answers).not.toHaveProperty('s_timeline');
    expect(answers).not.toHaveProperty('s_actions');
    expect(answers.s_status).toBe('active');
    expect(Object.keys(answers).filter((id) => id.startsWith('a_')).length).toBeGreaterThan(5);
    // התקציב נשמר גם במסלול שנוצר מחזרה אחורה
    expect(Object.keys(answers).filter((id) => isQuestion(screenOf(questionnaire, id)!))).toHaveLength(15);

    // ⚠ הגיזום חל על התשובה הסופית בלבד — השורות הגולמיות שומרות את שני
    // המסלולים, ולכן ניתוח עומק יכול לראות את השינוי (attempt מבדיל ביניהן)
    const statusAnswers = delivered.filter(
      (r) => r.event_type === 'answer' && r.screen_id === 's_status',
    );
    expect(statusAnswers.map((r) => r.payload.attempt)).toEqual([1, 2]);
    expect(statusAnswers.map((r) => r.payload.value)).toEqual(['none', 'active']);
    expect(delivered.some((r) => r.screen_id === 'b_deal_type')).toBe(true);
  }, 40_000);
});

describe('a refresh in the middle costs nothing', () => {
  it('keeps one session, one session_start, and every answer already given', async () => {
    const run = runner(questionnaire, { ...SEGMENTS.A });
    render(<App config={questionnaire} />);
    await run.run('a_refi');
    const before = delivered.length;

    cleanup();
    render(<App config={questionnaire} />);
    // המסך המשוחזר נרשם כצפייה נוספת (זו אכן צפייה), אבל לא כסשן חדש
    await drain();
    expect(delivered.filter((r) => r.event_type === 'session_start')).toHaveLength(1);
    expect(delivered.length).toBeGreaterThan(before);

    await run.run();
    await drain();

    expectWellFormed(delivered, questionnaire);
    const end = finalRow(delivered);
    expect(end.payload.answers).toEqual(run.answered);
    expect(new Set(delivered.map((r) => r.session_id)).size).toBe(1);
  }, 40_000);
});

describe('the queue survives a bad network', () => {
  it('retries the same rows after a server error, exactly once each', async () => {
    statuses = [500, 500]; // שני הניסיונות הראשונים נופלים
    const run = runner(questionnaire, { consent: 'declined' });
    render(<App config={questionnaire} />);
    await run.run();
    // כשל שרת מתוזמן ל-retry אחרי 5 שניות (events.ts) — ההמתנה חייבת להכיל אותו
    await drain(15_000);

    expect(attempts.length).toBeGreaterThan(2);
    expectWellFormed(delivered, questionnaire);
    expect(queueLength()).toBe(0);

    // אותם uid נשלחו שוב (ולכן ON CONFLICT בשרת הוא מה שמונע כפילות),
    // ואף שורה לא אבדה בדרך
    const firstTry = attempts[0].map((r) => r.event_uid);
    const deliveredUids = delivered.map((r) => r.event_uid);
    for (const uid of firstTry) expect(deliveredUids).toContain(uid);
    expect(new Set(deliveredUids).size).toBe(deliveredUids.length);
  }, 25_000);

  it('drops a batch the server calls invalid instead of retrying forever', async () => {
    statuses = [400];
    const run = runner(questionnaire, { consent: 'declined' });
    render(<App config={questionnaire} />);
    await run.run();
    await drain();

    expect(queueLength()).toBe(0);
    // האצווה שנדחתה אבדה בכוונה — אבל השליחה ממשיכה, ומה שהגיע תקין
    expect(attempts.length).toBeGreaterThan(1);
    for (const row of delivered) expect(sanitizeRow(row)).toEqual(row);
  });

  it('never sends a batch larger than the server accepts', async () => {
    const run = runner(questionnaire, { ...SEGMENTS.B });
    render(<App config={questionnaire} />);
    await run.run();
    await drain();

    expect(attempts.length).toBeGreaterThan(1); // 45+ אירועים ⇒ כמה אצוות
    for (const batch of attempts) {
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(20);
      expect(JSON.stringify(batch).length).toBeLessThan(200_000);
    }
  }, 30_000);
});

// ─────────── סוגי מסכים שאין בשאלון הנוכחי (שאלון עתידי כן ישתמש בהם) ───────────

const allTypes: SurveyConfig = {
  version: 'types-1',
  randomVars: { price: [39, 59, 79] },
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה', body: 'גוף' },
    { id: 'consent', type: 'consent', title: 'הסכמה', body: 'ג', agreeLabel: 'מסכים', declineLabel: 'לא מסכים' },
    { id: 'q_price', type: 'single', prompt: 'האם {price} ש״ח לחודש סביר?', options: [{ id: 'yes', label: 'כן' }, { id: 'no', label: 'לא' }] },
    { id: 'q_multi', type: 'multi', prompt: 'מה מפריע?', maxSelections: 2, options: [{ id: 'a', label: 'אלף' }, { id: 'b', label: 'בית' }, { id: 'c', label: 'גימל' }, { id: 'none', label: 'כלום', exclusive: true }] },
    { id: 'q_matrix', type: 'matrix', prompt: 'עד כמה קשה?', items: [{ id: 'i1', label: 'ראשון' }, { id: 'i2', label: 'שני' }], scaleMin: 1, scaleMax: 5, minLabel: 'כלל לא', maxLabel: 'מאוד', naLabel: 'לא רלוונטי' },
    { id: 'q_num', type: 'number', prompt: 'גיל?', min: 18, max: 99, integer: true },
    { id: 'q_open', type: 'text', prompt: 'ספרו בחופשיות', multiline: true },
    { id: 'q_skip', type: 'text', prompt: 'עוד משהו?', optional: true },
    { id: 'end_quota', type: 'end', variant: 'quotafull', title: 'המכסה מלאה', body: '' },
  ],
};

describe('every screen type stores a value the analysis can read', () => {
  it('text, optional-skip, matrix na, a random var and a quotafull ending', async () => {
    const run = runner(allTypes, {
      q_multi: ['a', 'b'],
      q_matrix: { i1: 3, i2: 'na' },
      q_num: 41,
      q_open: 'טקסט חופשי',
      q_skip: null,
    });
    render(<App config={allTypes} />);
    await run.run();
    await drain();

    expectWellFormed(delivered, allTypes);
    const end = finalRow(delivered);
    expect(end.event_type).toBe('quotafull');
    expect(end.payload.answers).toEqual({
      consent: 'agreed',
      q_price: 'yes',
      q_multi: ['a', 'b'],
      q_matrix: { i1: 3, i2: 'na' },
      q_num: 41,
      q_open: 'טקסט חופשי',
      q_skip: null,
    });
    // המשתנה המוגרל נשמר, וזה מה שמאפשר לנתח את הניסוי
    expect([39, 59, 79]).toContain((end.payload.vars as Record<string, unknown>).price);
  }, 20_000);

  it('an exclusive choice clears the rest, and the cap blocks a third pick', async () => {
    const user = userEvent.setup();
    render(<App config={allTypes} />);
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await user.click(screen.getByRole('button', { name: 'מסכים' }));
    await user.click(screen.getByRole('radio', { name: 'כן' }));
    await user.click(screen.getByRole('button', { name: 'המשך' }));

    await user.click(screen.getByRole('checkbox', { name: 'אלף' }));
    await user.click(screen.getByRole('checkbox', { name: 'בית' }));
    // מכסה מלאה: השלישית מנוטרלת ולא נבחרת בשקט
    expect((screen.getByRole('checkbox', { name: 'גימל' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('checkbox', { name: 'כלום' }));
    expect(screen.getByRole('checkbox', { name: 'אלף' }).getAttribute('aria-checked')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await drain();

    const row = delivered.find((r) => r.screen_id === 'q_multi' && r.event_type === 'answer')!;
    expect(row.payload.value).toEqual(['none']);
  });
});
