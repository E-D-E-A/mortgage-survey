// @vitest-environment jsdom
//
// The respondent app driven the way a respondent drives it — real clicks, real
// screen transitions. Everything else in the suite tests the engine's decisions
// in isolation; this file is the only place that checks the component actually
// carries them out.
//
// Two rules can only be observed here, because both are properties of the React
// lifecycle rather than of any function:
//   · a drawn A/B value is settled once per session and never moves again;
//   · the vars snapshot that rides along with every answer event.
//
// On reading events: in a dev build logEvent writes the row it would have sent
// into localStorage instead of posting it (data/events.ts). The row is built
// before that branch, so what is asserted below is the very payload the server
// would receive — without stubbing PROD, fetch, or the module graph.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { quotaFullVar } from './engine/quota';
import type { SurveyConfig, Vars } from './engine/types';

const PRICES = [79, 149, 249];
const FULL_YOUNG_COUPLE: Vars = { [quotaFullVar('persona', 'young_couple')]: true };

// Every screen prints the drawn price, so "did it move?" is answerable from what
// the respondent can see rather than from internal state.
const config: SurveyConfig = {
  version: 'ui-1',
  randomVars: { price: PRICES },
  varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: 50 } } },
  screens: [
    { id: 'intro', type: 'info', title: 'הצעה במחיר {price}', body: 'ברוכים הבאים', cta: 'מתחילים' },
    {
      id: 'q_fit',
      type: 'single',
      prompt: 'האם {price} מתאים לך?',
      options: [
        { id: 'yes', label: 'כן' },
        { id: 'no', label: 'לא' },
      ],
      onSubmit: [{ var: 'persona', value: 'young_couple' }],
    },
    { id: 'q_why', type: 'text', prompt: 'למה דווקא {price}?', optional: true },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה רבה', body: '' },
    { id: 'end_quotafull', type: 'end', variant: 'quotafull', title: 'המכסה כבר מלאה', body: '' },
  ],
};

interface DevEvent {
  event_type: string;
  screen_id: string | null;
  payload: Record<string, unknown>;
}

const eventsLogged = (): DevEvent[] =>
  JSON.parse(localStorage.getItem('sq_dev_events_v1') ?? '[]') as DevEvent[];

const lastEvent = (type: string, screenId?: string): DevEvent | undefined =>
  eventsLogged()
    .filter((e) => e.event_type === type && (screenId === undefined || e.screen_id === screenId))
    .pop();

/** Which of the three prices the respondent can currently read. Exactly one, always. */
const pricesOnScreen = (): number[] => {
  const text = document.body.textContent ?? '';
  return PRICES.filter((price) => text.includes(String(price)));
};

/**
 * The primary control, by its accessible name. Kept in one place on purpose: the
 * wording is the only thing here coupled to the interface's copy, so a rewording
 * is a one-line change rather than a sweep through the file.
 */
const CONTINUE = 'המשך';

beforeEach(() => {
  // First draw lands on 79; every draw after it would land on 249. So a value
  // that moves is visible, and one that is settled stays 79 all the way through
  // — which a fixed mock could never tell apart.
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99);
  // jsdom implements no layout, and App scrolls to the top on every screen
  vi.stubGlobal('scrollTo', vi.fn());
  // A dev build narrates every event to the console; the assertions read the
  // stored rows instead, so the narration is only noise in the test output
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a drawn value is settled once per session', () => {
  it('shows the same price on every screen the respondent walks through', async () => {
    const user = userEvent.setup();
    render(<App config={config} quota={{}} />);

    expect(pricesOnScreen()).toEqual([79]);
    await user.click(screen.getByRole('button', { name: 'מתחילים' }));
    expect(pricesOnScreen()).toEqual([79]);

    await user.click(screen.getByRole('radio', { name: 'כן' }));
    await user.click(screen.getByRole('button', { name: CONTINUE }));
    expect(pricesOnScreen()).toEqual([79]);
  });

  it('going back and answering again does not draw a new one', async () => {
    const user = userEvent.setup();
    render(<App config={config} quota={{}} />);

    await user.click(screen.getByRole('button', { name: 'מתחילים' }));
    await user.click(screen.getByRole('radio', { name: 'כן' }));
    await user.click(screen.getByRole('button', { name: CONTINUE }));

    await user.click(screen.getByRole('button', { name: /חזרה לשאלה הקודמת/ }));
    expect(pricesOnScreen()).toEqual([79]);

    await user.click(screen.getByRole('radio', { name: 'לא' }));
    await user.click(screen.getByRole('button', { name: CONTINUE }));
    expect(pricesOnScreen()).toEqual([79]);
  });

  it('a refresh mid-survey restores the price rather than rolling a new one', async () => {
    const user = userEvent.setup();
    const first = render(<App config={config} quota={{}} />);
    await user.click(screen.getByRole('button', { name: 'מתחילים' }));
    expect(pricesOnScreen()).toEqual([79]);

    first.unmount();
    render(<App config={config} quota={{}} />);

    // A fresh draw here would read 249 — the session is what keeps it at 79
    expect(pricesOnScreen()).toEqual([79]);
  });
});

describe('the events a session records', () => {
  it('every answer carries the vars as they stand after that screen', async () => {
    // Without this snapshot a session that is abandoned later reads as "unknown"
    // in every breakdown, however far the respondent actually got.
    const user = userEvent.setup();
    render(<App config={config} quota={{}} />);

    await user.click(screen.getByRole('button', { name: 'מתחילים' }));
    await user.click(screen.getByRole('radio', { name: 'כן' }));
    await user.click(screen.getByRole('button', { name: CONTINUE }));

    expect(lastEvent('answer', 'q_fit')?.payload.vars).toMatchObject({
      persona: 'young_couple',
      price: 79,
    });
  });

  it('a ?test=1 link is recorded as url_test on the session_start event', async () => {
    // The single mechanism every statistic excludes by. It is captured here, at
    // the start of the session, and nowhere else.
    window.history.replaceState({}, '', '/?test=1');
    render(<App config={config} quota={{}} />);

    expect(lastEvent('session_start')?.payload.vars).toMatchObject({ url_test: '1' });
  });
});

describe('a full quota, from the respondent’s side', () => {
  it('sends them to the quota-full screen as soon as they are marked', async () => {
    const user = userEvent.setup();
    render(<App config={config} quota={FULL_YOUNG_COUPLE} />);

    await user.click(screen.getByRole('button', { name: 'מתחילים' }));
    await user.click(screen.getByRole('radio', { name: 'כן' }));
    await user.click(screen.getByRole('button', { name: CONTINUE }));

    expect(screen.getByText('המכסה כבר מלאה')).toBeDefined();
    expect(lastEvent('quotafull')?.screen_id).toBe('end_quotafull');
  });

  it('a respondent whose cell is open finishes the survey as normal', async () => {
    const user = userEvent.setup();
    render(<App config={config} quota={{}} />);

    await user.click(screen.getByRole('button', { name: 'מתחילים' }));
    await user.click(screen.getByRole('radio', { name: 'כן' }));
    await user.click(screen.getByRole('button', { name: CONTINUE }));
    // The open question is optional, so the button offers to skip it
    await user.click(screen.getByRole('button', { name: 'דילוג' }));

    expect(screen.getByText('תודה רבה')).toBeDefined();
    expect(lastEvent('complete')?.screen_id).toBe('end_complete');
  });
});
