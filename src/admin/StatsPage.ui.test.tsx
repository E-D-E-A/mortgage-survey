// @vitest-environment jsdom
//
// The statistics screen: the tiles, the control bar, the empty states and the
// open-answers tab (ENG-13 · ENG-15 · ENG-16 · ENG-17).
//
// stats.ts is unit-tested underneath, so the shaping of every number is already
// covered. What only this file can see is whether the page asks the server the
// right question when a control moves, and whether it says anything useful when
// the answer comes back empty.
//
// Queries are anchored on the sections' aria-labels rather than class names, so
// restyling cannot break them and an assertion cannot accidentally match a number
// belonging to a different section.
//
// Two seams are stubbed and no more:
//   · ./supabaseClient — the console's auth adapter, so a request carries a token;
//   · fetch — so the page is fed a payload we control instead of a live database.
// Everything between them, api.ts included, is the real code path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpenAnswersPage, StatsBundle } from './api';
import type { SurveyConfig } from '../engine/types';

vi.mock('./supabaseClient', () => ({
  accessToken: async () => 'test-token',
  supabase: { auth: { signOut: vi.fn() } },
  authConfigured: true,
  adminRedirectUrl: '',
  signInWithGoogle: vi.fn(),
}));

const { StatsPage } = await import('./StatsPage');

const V1 = '2026-08-01.1-demo';

const OVERVIEW = 'סקירה כללית';
const DISTRIBUTIONS = 'התפלגויות תשובות';
const OPEN_ANSWERS = 'תשובות פתוחות';

const config: SurveyConfig = {
  version: V1,
  varMeta: { segment: { label: 'מסלול המשיב', values: { A: 'מסלול א', B: 'מסלול ב' } } },
  screens: [
    {
      id: 'q_fit',
      type: 'single',
      prompt: 'האם זה מתאים?',
      options: [
        { id: 'yes', label: 'כן' },
        { id: 'no', label: 'לא' },
      ],
    },
    { id: 'q_budget', type: 'number', prompt: 'מה התקציב?' },
    { id: 'q_why', type: 'text', prompt: 'למה?' },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

const bundle: StatsBundle = {
  survey: 'demo',
  name: 'שאלון הדגמה',
  versions: [{ version: V1, published_at: '2026-08-01T10:00:00Z', config }],
  overview: {
    total_sessions: 100,
    completed: 60,
    screened_out: 15,
    quota_full: 5,
    abandoned_mid: 12,
    abandoned_bounce: 8,
  },
  funnel: [
    { screen_id: 'q_fit', viewed: 100, answered: 80, dropped_here: 4, median_ms: 4200 },
    { screen_id: 'q_budget', viewed: 80, answered: 70, dropped_here: 3, median_ms: 9100 },
    { screen_id: 'q_why', viewed: 70, answered: 40, dropped_here: 6, median_ms: 15000 },
  ],
  distributions: [
    { screen_id: 'q_fit', item_id: null, answer_key: 'yes', dim_value: null, n: 55 },
    { screen_id: 'q_fit', item_id: null, answer_key: 'no', dim_value: null, n: 25 },
    { screen_id: 'q_budget', item_id: null, answer_key: '900000', dim_value: null, n: 40 },
    { screen_id: 'q_budget', item_id: null, answer_key: '1200000', dim_value: null, n: 30 },
  ],
  by: null,
  bases: [],
};

const emptyOverview = {
  total_sessions: 0,
  completed: 0,
  screened_out: 0,
  quota_full: 0,
  abandoned_mid: 0,
  abandoned_bounce: 0,
};

const answersPage: OpenAnswersPage = {
  stats: [
    {
      screen_id: 'q_why',
      answered: 40,
      skipped: 12,
      abandoned: 18,
      len_min: 4,
      len_median: 22,
      len_p90: 80,
      len_max: 140,
    },
  ],
  total: 40,
  rows: [
    {
      screen_id: 'q_why',
      value: 'הריבית מפחידה אותי',
      created_at: '2026-08-10T09:00:00Z',
      survey_version: V1,
      dim_value: 'A',
      outcome: 'complete',
    },
  ],
};

/** Every request the page made, in order. */
let calls: string[] = [];

/** Answers admin-stats with `stats` (or a bare status code) and admin-answers with `answers`. */
function serve(stats: StatsBundle | number = bundle, answers: OpenAnswersPage = answersPage): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('admin-answers')) {
        return new Response(JSON.stringify(answers), { status: 200 });
      }
      if (typeof stats === 'number') return new Response('nope', { status: stats });
      return new Response(JSON.stringify(stats), { status: 200 });
    }),
  );
}

const renderPage = () =>
  render(
    <StatsPage
      slug="demo"
      name="שאלון הדגמה"
      email="admin@first-edea.com"
      onBack={() => {}}
      onOpenEditor={() => {}}
      onAuthError={() => {}}
    />,
  );

/** The query string of the most recent admin-stats request. */
const lastStatsCall = () => new URL(calls.filter((c) => c.includes('admin-stats')).pop()!, 'http://x');

/** Waits for the first load to settle, and hands back the tiles section. */
async function loaded(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('region', { name: OVERVIEW }));
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the overview tiles', () => {
  it('shows every headline number the researcher opens the page for', async () => {
    serve();
    renderPage();
    const tiles = await loaded();

    for (const n of ['100', '60', '15', '5']) {
      expect(within(tiles).getByText(n), `tile ${n} is missing`).toBeDefined();
    }
    // Abandonment is a single tile, with the two-way split spelled out beneath it
    expect(within(tiles).getByText('20')).toBeDefined();
    expect(within(tiles).getByText(/12/)).toBeDefined();
    expect(within(tiles).getByText(/8/)).toBeDefined();
  });

  it('formats numbers for a Hebrew reader rather than printing raw digits', async () => {
    serve({ ...bundle, overview: { ...emptyOverview, total_sessions: 12345, completed: 6000 } });
    renderPage();
    const tiles = await loaded();

    expect(within(tiles).getByText('12,345')).toBeDefined();
  });
});

describe('the control bar', () => {
  it('asks for one version once the researcher picks it', async () => {
    const user = userEvent.setup();
    serve();
    renderPage();
    await loaded();

    await user.selectOptions(screen.getByRole('combobox', { name: /גרסה/ }), V1);

    await waitFor(() => expect(lastStatsCall().searchParams.get('version')).toBe(V1));
  });

  it('asks for the test sessions only once the toggle is on', async () => {
    const user = userEvent.setup();
    serve();
    renderPage();
    await loaded();

    // Excluded by default — that is the whole rule
    expect(lastStatsCall().searchParams.get('include_test')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: /סשני בדיקה/ }));

    await waitFor(() => expect(lastStatsCall().searchParams.get('include_test')).toBe('1'));
  });

  it('carries the chosen breakdown through to the request', async () => {
    const user = userEvent.setup();
    serve();
    renderPage();
    await loaded();

    await user.selectOptions(screen.getByRole('combobox', { name: /פילוח/ }), 'segment');

    await waitFor(() => expect(lastStatsCall().searchParams.get('by')).toBe('segment'));
  });
});

describe('the question cards', () => {
  it('names options by their wording — the analysis codes never reach the screen', async () => {
    serve();
    renderPage();
    await loaded();

    const cards = await waitFor(() => screen.getByRole('region', { name: DISTRIBUTIONS }));
    expect(within(cards).getByText('האם זה מתאים?')).toBeDefined();
    expect(within(cards).getByText('כן')).toBeDefined();
    expect(within(cards).getByText('לא')).toBeDefined();
    expect(within(cards).queryByText('yes')).toBeNull();
    expect(within(cards).queryByText('no')).toBeNull();
  });

  it('gives the number question a card of its own', async () => {
    serve();
    renderPage();
    await loaded();

    const cards = await waitFor(() => screen.getByRole('region', { name: DISTRIBUTIONS }));
    expect(within(cards).getByText('מה התקציב?')).toBeDefined();
  });
});

describe('empty and failed states', () => {
  it('explains itself when the survey has never been published', async () => {
    serve({ ...bundle, versions: [], distributions: [], funnel: [], overview: emptyOverview });
    renderPage();

    await waitFor(() => expect(screen.getByText(/טרם פורסמה גרסה/)).toBeDefined());
    // No tiles at all — there is nothing to put in them
    expect(screen.queryByRole('region', { name: OVERVIEW })).toBeNull();
  });

  it('says there are no sessions yet instead of drawing empty charts', async () => {
    serve({ ...bundle, distributions: [], funnel: [], overview: emptyOverview });
    renderPage();

    await waitFor(() => expect(screen.getByText(/אין עדיין סשנים/)).toBeDefined());
    expect(screen.queryByRole('region', { name: DISTRIBUTIONS })).toBeNull();
  });

  it('names the exclusion in the empty state, so a zero is not mistaken for no data', async () => {
    // "No sessions" and "no sessions once the test ones are set aside" are very
    // different messages to a researcher looking at a fresh survey.
    serve({ ...bundle, distributions: [], funnel: [], overview: emptyOverview });
    renderPage();

    await waitFor(() => expect(screen.getByText(/לא כולל סשני בדיקה/)).toBeDefined());
  });

  it('reports a server failure instead of rendering a blank page', async () => {
    serve(500);
    renderPage();

    await waitFor(() => expect(screen.getByText(/טעינת הנתונים נכשלה/)).toBeDefined());
  });
});

describe('the open-answers tab', () => {
  it('lists the raw text with its session context, under a header that needs no reading', async () => {
    const user = userEvent.setup();
    serve();
    renderPage();
    await loaded();

    await user.click(screen.getByRole('tab', { name: OPEN_ANSWERS }));

    const tab = await waitFor(() => screen.getByRole('region', { name: OPEN_ANSWERS }));
    expect(within(tab).getByText('הריבית מפחידה אותי')).toBeDefined();
    // The three states, each next to its own word — a bare number would not tell
    // the researcher which of them it counts
    expect(tab.textContent).toContain('ענו 40');
    expect(tab.textContent).toContain('דילגו 12');
    expect(tab.textContent).toContain('נטשו 18');
    // And the row's session context beside the text itself
    expect(tab.textContent).toContain(V1);
  });

  it('asks the answers endpoint only for the survey’s text questions', async () => {
    // The browser is what knows which screens are open questions — SQL has no
    // notion of a screen type, so sending the wrong list returns the wrong tab.
    const user = userEvent.setup();
    serve();
    renderPage();
    await loaded();

    await user.click(screen.getByRole('tab', { name: OPEN_ANSWERS }));

    await waitFor(() => {
      const call = calls.filter((c) => c.includes('admin-answers')).pop();
      expect(call).toBeDefined();
      expect(new URL(call!, 'http://x').searchParams.get('screens')).toBe('q_why');
    });
  });
});
