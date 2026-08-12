import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, interpolate } from './engine/conditions';
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
  /** מקסימום רץ של ההתקדמות — פס שנסוג אחורה גרוע מפס לא מדויק */
  maxProgress: number;
  /**
   * כמה פעמים כבר נענה כל מסך. `history` הוא מחסנית ניווט ש-back מוציא ממנה,
   * ולכן אי אפשר לספור ממנה מענה חוזר — צריך מונה שרק עולה.
   */
  attempts: Record<string, number>;
}

// מפתחות מוגבלים לשאלון (session-scope.ts): שני שאלונים באותה לשונית לא
// משחזרים זה את המצב של זה.
const STATE_KEY = 'sq_state_v1';
const STARTED_KEY = 'sq_started_v1';

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
    maxProgress: 0,
    attempts: {},
  };
}

// הקונפיג נבחר לפי הגרסה השמורה (loadConfig מצמיד גרסה לסשן), ולכן
// אי-התאמה כאן אפשרית רק בפיתוח או אחרי איפוס — ואז מתחילים מחדש.
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

export default function App({ config }: { config: SurveyConfig }) {
  const [state, setState] = useState<SurveyState>(() => {
    const restored = restoreState(config);
    if (restored) return restored;
    const fresh = freshState(config);
    // sessionStorage guard: StrictMode מריץ את ה-initializer פעמיים בפיתוח,
    // וכל הרצה מגרילה event_uid חדש — בלי הגנה נרשמות שתי שורות session_start
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
   * כמה רשומות היסטוריה דחפנו בלשונית הזאת. השאלון הוא דף אחד, ולכן בלי זה
   * לחיצה על "אחורה" במכשיר — התנועה הכי טבעית במובייל — נוטשת את השאלון
   * כולו במקום לחזור שאלה אחת. אחרי רענון המונה מתאפס אף שיש מסכים בהיסטוריה
   * הפנימית, ולכן הוא נבדק לפני שקוראים ל-history.back().
   */
  const depth = useRef(0);
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    window.history.replaceState({ sq: 0 }, '');
    const onPop = (e: PopStateEvent) => {
      const sq = (e.state as { sq?: number } | null)?.sq;
      const to = typeof sq === 'number' ? sq : 0;
      // רק אחורה. "קדימה" יצריך לשחזר מסלול שכבר נגזם, ולכן הוא לא מזיז מסך.
      for (let i = depth.current - to; i > 0; i--) backRef.current();
      depth.current = to;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goBack = () => {
    if (depth.current > 0) window.history.back(); // popstate הוא שיבצע את החזרה
    else back(); // רענון באמצע השאלון — אין רשומת היסטוריה משלנו לפתוח
  };

  // מראה של state.attempts לאירוע ה-screen_view: הוא נורה מ-useEffect שתלוי
  // במסך בלבד (תלות ב-attempts הייתה מייצרת screen_view כפול על כל מענה),
  // ולכן הוא זקוק לערך עדכני בלי לעבור דרך תלות. מתעדכן ב-submit בלבד.
  const attemptsRef = useRef(state.attempts);

  const enteredAt = useRef(Date.now());
  useEffect(() => {
    enteredAt.current = Date.now();
    if (screen.type !== 'end') {
      logEvent(config.version, 'screen_view', screen.id, {
        index: config.screens.findIndex((s) => s.id === screen.id),
        // צפייה חוזרת אחרי חזרה אחורה — אותו מספר כמו ב-answer שיבוא אחריה
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

    // חזרה אחורה ומענה חוזר מפיקים שורת answer נוספת לאותו מסך; attempt
    // מאפשר לניתוח לקחת את המענה האחרון בלי לנחש לפי חותמות זמן, ולזהות
    // שהמענה החוזר הוא זה שמטה את avg_ms_on_screen כלפי מטה
    const attempt = (state.attempts[screen.id] ?? 0) + 1;
    attemptsRef.current = { ...attemptsRef.current, [screen.id]: attempt };
    if (value !== undefined) {
      logEvent(config.version, 'answer', screen.id, {
        value,
        ms: Date.now() - enteredAt.current,
        attempt,
        // צילום ה-vars אחרי כללי onSubmit: סשן שנוטש בהמשך נושא את הפילוח
        // (segment וכד') עד לנקודה שאליה הגיע — בלי זה נטישה = "לא ידוע" בניתוח
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
      // variant ו-EventType חולקים בכוונה את אותם שמות: complete / screenout /
      // quotafull. מסך מכסה-מלאה נרשם כסוג משלו ולא מתערבב עם סינון אמיתי.
      logEvent(config.version, next.variant, next.id, {
        variant: next.variant,
        // ⚠ ה-payload נגזם: תשובות ממקטע שהמשיב נטש (חזר אחורה ושינה תשובה
        // שמנתבת) אינן חלק מהתשובה הסופית שלו ואסור שיזהמו את הניתוח
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
   * מעבר מסך אינו טעינת דף: הכפתור שנלחץ נעלם, והמיקוד נופל ל-body. משתמש
   * מקלדת נאלץ אז לטייל מחדש מראש הדף בכל שאלה, וקורא מסך שותק. העברת
   * המיקוד לכותרת פותרת את שניהם — וגם מגלגלת את הדף לראש המסך החדש.
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
      {/* ההכרזה על המסך החדש נעשית בהעברת המיקוד לכותרת (ראו cardRef למעלה).
          אזור live נוסף היה מקריא את אותה כותרת פעמיים */}
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

/**
 * `initial` היא התשובה שכבר נשמרה למסך הזה. הצרה לטיפוס נעשית כאן ולא בתוך
 * ה-View: תשובה שנשמרה תחת סוג מסך אחר (עריכה בקונסולה שינתה את הסוג) פשוט
 * לא נזרעת, במקום לרנדר ערך שגוי.
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
