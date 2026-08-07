import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, interpolate } from './engine/conditions';
import { pickRandom } from './engine/random';
import type { AnswerValue, Screen, SurveyConfig, SurveyContext, Vars } from './engine/types';
import { eventsEnabled, logEvent } from './data/events';
import {
  ConsentView,
  InfoView,
  MatrixView,
  MultiChoiceView,
  NumberView,
  SingleChoiceView,
  TextView,
  type SubmitFn,
} from './components/inputs';
import { questionnaire } from './questionnaire/placeholder';

interface SurveyState {
  version: string;
  current: string;
  answers: SurveyContext['answers'];
  vars: Vars;
  history: string[];
  startedAt: number;
  finished: boolean;
}

const STATE_KEY = 'sq_state_v1';

function initVars(config: SurveyConfig): Vars {
  const vars: Vars = {};
  for (const [name, values] of Object.entries(config.randomVars ?? {})) {
    vars[name] = pickRandom(values);
  }
  for (const [k, v] of new URLSearchParams(window.location.search)) {
    vars[`url_${k}`] = v;
  }
  return vars;
}

function freshState(config: SurveyConfig): SurveyState {
  return {
    version: config.version,
    current: config.screens[0].id,
    answers: {},
    vars: initVars(config),
    history: [],
    startedAt: Date.now(),
    finished: false,
  };
}

function restoreState(config: SurveyConfig): SurveyState | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SurveyState;
    if (saved.version !== config.version) return null;
    if (!config.screens.some((s) => s.id === saved.current)) return null;
    return saved;
  } catch {
    return null;
  }
}

export default function App() {
  const config = questionnaire;
  const [state, setState] = useState<SurveyState>(() => {
    const restored = restoreState(config);
    if (restored) return restored;
    const fresh = freshState(config);
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
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const screen = useMemo(
    () => config.screens.find((s) => s.id === state.current)!,
    [config, state.current],
  );

  const enteredAt = useRef(Date.now());
  useEffect(() => {
    enteredAt.current = Date.now();
    if (screen.type !== 'end') {
      logEvent(config.version, 'screen_view', screen.id, {
        index: config.screens.findIndex((s) => s.id === screen.id),
      });
    }
  }, [config, screen]);

  function findNext(from: Screen, ctx: SurveyContext): Screen | null {
    for (const rule of from.next ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) {
        return config.screens.find((s) => s.id === rule.goto) ?? null;
      }
    }
    const idx = config.screens.findIndex((s) => s.id === from.id);
    for (let i = idx + 1; i < config.screens.length; i++) {
      const candidate = config.screens[i];
      if (!candidate.showIf || evaluate(candidate.showIf, ctx)) return candidate;
    }
    return null;
  }

  const submit: SubmitFn = (value, extra) => {
    const answers =
      value === undefined ? state.answers : { ...state.answers, [screen.id]: value as AnswerValue };
    const vars = { ...state.vars };
    const ctx: SurveyContext = { answers, vars };
    for (const rule of screen.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) vars[rule.var] = rule.value;
    }

    if (value !== undefined) {
      logEvent(config.version, 'answer', screen.id, {
        value,
        ms: Date.now() - enteredAt.current,
        ...extra,
      });
    }

    const next = findNext(screen, ctx);
    let finished = state.finished;
    if (next && next.type === 'end' && !finished) {
      finished = true;
      logEvent(config.version, next.variant === 'complete' ? 'complete' : 'screenout', next.id, {
        variant: next.variant,
        answers,
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
    }));
  };

  function back() {
    setState((prev) => {
      const history = [...prev.history];
      const last = history.pop();
      if (!last) return prev;
      return { ...prev, current: last, history };
    });
  }

  const ctx: SurveyContext = { answers: state.answers, vars: state.vars };
  const progress =
    config.screens.findIndex((s) => s.id === screen.id) / Math.max(config.screens.length - 1, 1);

  return (
    <div className="app">
      {!eventsEnabled && (
        <div className="dev-banner">מצב פיתוח — תשובות לא נשלחות לשרת (חסרים משתני סביבה)</div>
      )}
      {screen.type !== 'end' && (
        <div className="progress">
          <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <main className="card" key={screen.id}>
        <ScreenView screen={withInterpolation(screen, ctx)} submit={submit} />
        {screen.type !== 'end' && screen.type !== 'info' && state.history.length > 0 && (
          <button className="btn link" onClick={back}>
            → חזרה לשאלה הקודמת
          </button>
        )}
      </main>
    </div>
  );
}

/** מחיל אינטרפולציה של משתנים ({price} וכד') על נוסחי המסך לפני רינדור. */
function withInterpolation(screen: Screen, ctx: SurveyContext): Screen {
  const t = (s: string) => interpolate(s, ctx);
  switch (screen.type) {
    case 'info':
      return { ...screen, title: t(screen.title), body: t(screen.body) };
    case 'consent':
      return { ...screen, title: t(screen.title), body: t(screen.body) };
    case 'single':
    case 'multi':
      return { ...screen, prompt: t(screen.prompt) };
    case 'matrix':
      return { ...screen, prompt: t(screen.prompt) };
    case 'number':
    case 'text':
      return { ...screen, prompt: t(screen.prompt) };
    case 'end':
      return { ...screen, title: t(screen.title), body: t(screen.body) };
  }
}

function ScreenView({ screen, submit }: { screen: Screen; submit: SubmitFn }) {
  switch (screen.type) {
    case 'info':
      return <InfoView screen={screen} submit={submit} />;
    case 'consent':
      return <ConsentView screen={screen} submit={submit} />;
    case 'single':
      return <SingleChoiceView screen={screen} submit={submit} />;
    case 'multi':
      return <MultiChoiceView screen={screen} submit={submit} />;
    case 'matrix':
      return <MatrixView screen={screen} submit={submit} />;
    case 'number':
      return <NumberView screen={screen} submit={submit} />;
    case 'text':
      return <TextView screen={screen} submit={submit} />;
    case 'end':
      return (
        <div className="screen center">
          <div className="end-icon">{screen.variant === 'complete' ? '✓' : 'ℹ'}</div>
          <h1>{screen.title}</h1>
          <p>{screen.body}</p>
        </div>
      );
  }
}
