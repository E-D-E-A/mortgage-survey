import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, interpolate, mapInterpolatedTexts } from './engine/conditions';
import { findNext } from './engine/navigation';
import { progressRatio, pruneAnswers } from './engine/path';
import { pickRandom } from './engine/random';
import type { AnswerValue, Screen, SurveyConfig, SurveyContext, Vars } from './engine/types';
import { eventsEnabled, logEvent } from './data/events';
import { scopedKey } from './data/session-scope';
import {
  ConsentView,
  InfoView,
  MatrixView,
  MultiChoiceView,
  NumberView,
  SCREEN_TITLE_CLASS,
  ScreenTitle,
  SingleChoiceView,
  TextView,
  type SubmitFn,
} from './components/inputs';

interface SurveyState {
  version: string;
  current: string;
  answers: SurveyContext['answers'];
  vars: Vars;
  history: string[];
  startedAt: number;
  finished: boolean;
  /** A running maximum of the progress — a bar that retreats is worse than an imprecise one */
  maxProgress: number;
  /**
   * How many times each screen has been answered. `history` is a navigation
   * stack that back pops from, so a repeat answer cannot be counted from it —
   * that needs a counter that only ever goes up.
   */
  attempts: Record<string, number>;
}

// Keys scoped to the survey (session-scope.ts): two surveys in the same tab do
// not restore each other's state.
const STATE_KEY = 'sq_state_v1';
const STARTED_KEY = 'sq_started_v1';

// quota — the flags for cells that are already full (data/quota.ts). They come in
// as ordinary session vars, which is also why they end up in the session_start
// payload: analysis can tell which cells were closed the moment a respondent
// arrived.
function initVars(config: SurveyConfig, quota: Vars): Vars {
  const vars: Vars = { ...quota };
  for (const [name, values] of Object.entries(config.randomVars ?? {})) {
    vars[name] = pickRandom(values);
  }
  for (const [k, v] of new URLSearchParams(window.location.search)) {
    vars[`url_${k}`] = v;
  }
  return vars;
}

function freshState(config: SurveyConfig, quota: Vars): SurveyState {
  return {
    version: config.version,
    current: config.screens[0].id,
    answers: {},
    vars: initVars(config, quota),
    history: [],
    startedAt: Date.now(),
    finished: false,
    maxProgress: 0,
    attempts: {},
  };
}

// The config is chosen by the saved version (loadConfig pins a version to the
// session), so a mismatch here is only possible in development or after a reset
// — and then we start over.
function restoreState(config: SurveyConfig): SurveyState | null {
  try {
    const raw = sessionStorage.getItem(scopedKey(STATE_KEY));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SurveyState;
    if (saved.version !== config.version) return null;
    if (!config.screens.some((s) => s.id === saved.current)) return null;
    return { ...saved, maxProgress: saved.maxProgress ?? 0, attempts: saved.attempts ?? {} };
  } catch {
    return null;
  }
}

export default function App({ config, quota }: { config: SurveyConfig; quota: Vars }) {
  const [state, setState] = useState<SurveyState>(() => {
    const restored = restoreState(config);
    if (restored) return restored;
    const fresh = freshState(config, quota);
    // sessionStorage guard: StrictMode runs the initializer twice in
    // development, and each run draws a fresh event_uid — without the guard two
    // session_start rows are recorded
    if (sessionStorage.getItem(scopedKey(STARTED_KEY))) return fresh;
    sessionStorage.setItem(scopedKey(STARTED_KEY), '1');
    logEvent(config.version, 'session_start', null, {
      vars: fresh.vars,
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      referrer: document.referrer,
    });
    return fresh;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(scopedKey(STATE_KEY), JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const screen = useMemo(
    () => config.screens.find((s) => s.id === state.current)!,
    [config, state.current],
  );

  function back() {
    setState((prev) => {
      const history = [...prev.history];
      const last = history.pop();
      if (!last) return prev;
      return { ...prev, current: last, history };
    });
  }

  /**
   * How many history entries we have pushed in this tab. The survey is a single
   * page, so without this the device's "back" — the most natural gesture on
   * mobile — abandons the whole survey instead of going back one question. After
   * a refresh the counter resets even though the internal history still has
   * screens in it, which is why it is checked before calling history.back().
   */
  const depth = useRef(0);
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    window.history.replaceState({ sq: 0 }, '');
    const onPop = (e: PopStateEvent) => {
      const sq = (e.state as { sq?: number } | null)?.sq;
      const to = typeof sq === 'number' ? sq : 0;
      // Backwards only. "Forward" would require restoring a path that has
      // already been pruned, so it moves no screen.
      for (let i = depth.current - to; i > 0; i--) backRef.current();
      depth.current = to;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goBack = () => {
    if (depth.current > 0) window.history.back(); // popstate is what performs the step back
    else back(); // refreshed mid-survey — we have no history entry of our own to pop
  };

  // A mirror of state.attempts for the screen_view event: that event fires from
  // a useEffect that depends on the screen alone (depending on attempts would
  // produce a duplicate screen_view on every answer), so it needs a current
  // value without going through a dependency. Updated in submit only.
  const attemptsRef = useRef(state.attempts);

  const enteredAt = useRef(Date.now());
  useEffect(() => {
    enteredAt.current = Date.now();
    if (screen.type !== 'end') {
      logEvent(config.version, 'screen_view', screen.id, {
        index: config.screens.findIndex((s) => s.id === screen.id),
        // A repeat view after going back — the same number as the answer that follows it
        attempt: (attemptsRef.current[screen.id] ?? 0) + 1,
      });
    }
  }, [config, screen]);

  const submit: SubmitFn = (value, extra) => {
    const answers =
      value === undefined ? state.answers : { ...state.answers, [screen.id]: value as AnswerValue };
    const vars = { ...state.vars };
    const ctx: SurveyContext = { answers, vars };
    for (const rule of screen.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) vars[rule.var] = rule.value;
    }

    // Going back and answering again produces another answer row for the same
    // screen; attempt lets analysis take the last answer without guessing from
    // timestamps, and lets it see that the repeat answer is what drags
    // avg_ms_on_screen down
    const attempt = (state.attempts[screen.id] ?? 0) + 1;
    attemptsRef.current = { ...attemptsRef.current, [screen.id]: attempt };
    if (value !== undefined) {
      logEvent(config.version, 'answer', screen.id, {
        value,
        ms: Date.now() - enteredAt.current,
        attempt,
        // A snapshot of vars after the onSubmit rules: a session that is
        // abandoned later still carries its breakdown (segment and the like) up
        // to the point it reached — without this, abandonment reads as "unknown"
        // in analysis
        vars: { ...vars },
        ...extra,
      });
    }

    const next = findNext(config, screen, ctx);
    if (next) {
      depth.current += 1;
      window.history.pushState({ sq: depth.current }, '');
    }
    let finished = state.finished;
    if (next && next.type === 'end' && !finished) {
      finished = true;
      // variant and EventType deliberately share the same names: complete /
      // screenout / quotafull. A quota-full screen is recorded as its own type
      // and does not get mixed in with a genuine screenout.
      logEvent(config.version, next.variant, next.id, {
        variant: next.variant,
        // ⚠ The payload is pruned: answers from a branch the respondent left
        // (went back and changed a routing answer) are not part of their final
        // response and must not contaminate the analysis
        answers: pruneAnswers(config, { answers, vars }),
        vars,
        totalMs: Date.now() - state.startedAt,
      });
    }

    setState((prev) => ({
      ...prev,
      current: next ? next.id : prev.current,
      answers,
      vars,
      history: [...prev.history, screen.id],
      finished,
      maxProgress: next
        ? Math.max(prev.maxProgress, progressRatio(config, next.id, { answers, vars }))
        : prev.maxProgress,
      attempts: { ...prev.attempts, [screen.id]: attempt },
    }));
  };

  const ctx: SurveyContext = { answers: state.answers, vars: state.vars };
  const percent = Math.round(state.maxProgress * 100);
  const shown = withInterpolation(screen, ctx);

  /**
   * Moving between screens is not a page load: the button that was clicked
   * disappears and focus falls to body. A keyboard user then has to travel from
   * the top of the page again on every question, and a screen reader says
   * nothing. Moving focus to the heading solves both — and scrolls the page to
   * the top of the new screen as well.
   */
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>(`.${SCREEN_TITLE_CLASS}`)?.focus();
    window.scrollTo(0, 0);
  }, [state.current]);

  return (
    <div className="app">
      {!eventsEnabled && (
        <div className="dev-banner">מצב פיתוח — תשובות נכתבות לקונסול בלבד ולא נשלחות לשרת</div>
      )}
      {screen.type !== 'end' && (
        <div
          className="progress"
          role="progressbar"
          aria-label="התקדמות בשאלון"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${percent} אחוז`}
        >
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
      {/* The new screen is announced by moving focus to the heading (see cardRef
          above). An additional live region would read that same heading twice */}
      <main className="card" key={screen.id} ref={cardRef}>
        <ScreenView screen={shown} submit={submit} initial={state.answers[screen.id]} />
        {screen.type !== 'end' && screen.type !== 'info' && state.history.length > 0 && (
          <button className="btn link" onClick={goBack}>
            → חזרה לשאלה הקודמת
          </button>
        )}
      </main>
    </div>
  );
}

/** Applies variable interpolation ({price} and the like) to the screen text before rendering. */
function withInterpolation(screen: Screen, ctx: SurveyContext): Screen {
  return mapInterpolatedTexts(screen, (s) => interpolate(s, ctx));
}

/**
 * `initial` is the answer already saved for this screen. The narrowing to a type
 * happens here and not inside the View: an answer saved under a different screen
 * type (an edit in the console changed the type) is simply not seeded, rather
 * than rendering a wrong value.
 */
function ScreenView({
  screen,
  submit,
  initial,
}: {
  screen: Screen;
  submit: SubmitFn;
  initial?: AnswerValue;
}) {
  switch (screen.type) {
    case 'info':
      return <InfoView screen={screen} submit={submit} />;
    case 'consent':
      return <ConsentView screen={screen} submit={submit} />;
    case 'single':
      return <SingleChoiceView screen={screen} submit={submit} initial={initial} />;
    case 'multi':
      return <MultiChoiceView screen={screen} submit={submit} initial={initial} />;
    case 'matrix':
      return <MatrixView screen={screen} submit={submit} initial={initial} />;
    case 'number':
      return <NumberView screen={screen} submit={submit} initial={initial} />;
    case 'text':
      return <TextView screen={screen} submit={submit} initial={initial} />;
    case 'end':
      return (
        <div className="screen center">
          <div className="end-icon" aria-hidden="true">
            {screen.variant === 'complete' ? '✓' : 'ℹ'}
          </div>
          <ScreenTitle>{screen.title}</ScreenTitle>
          <p>{screen.body}</p>
        </div>
      );
  }
}
