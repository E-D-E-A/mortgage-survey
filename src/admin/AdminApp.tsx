// The admin console (/admin): a sign-in gate (Supabase Auth, first-edea.com
// only), and behind it two screens — the survey list (/admin) and the editor for
// one survey (/admin/<slug>): a draggable screen list, a screen editor, live
// validation, saving and publishing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { Answers, Screen, SurveyConfig, Vars } from '../engine/types';
import { simulatePath } from '../engine/path';
import { validateConfig } from '../engine/validate';
import { isValidSlug, surveyPath } from '../data/surveys';
import { useDraft } from './useDraft';
import { useSurveys } from './useSurveys';
import { insertScreen } from './edits';
import {
  defineVar as defineVarIn,
  defineVarValue as defineVarValueIn,
  renameVar,
  renameVarValue,
} from './vars';
import { makeNaming, screenLabel } from './display';
import { LoginScreen } from './LoginScreen';
import { SurveyList } from './SurveyList';
import { supabase } from './supabaseClient';
import { ScreenList } from './ScreenList';
import { ScreenEditor } from './ScreenEditor';
import { StatsPage } from './StatsPage';
import { FlowGraph } from './FlowGraph';
import { Simulator } from './Simulator';
import { ValidationPanel } from './ValidationPanel';
import { PanelResizer } from './PanelResizer';
import { PublishDialog } from './PublishDialog';
import { SurveySettings } from './SurveySettings';
import { CloseIcon, ErrorIcon, LogoutIcon, PanelIcon, RedoIcon, UndoIcon, WarningIcon } from './Icons';
import './admin.css';

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);

/**
 * Below this width the console was never built to work: the flow diagram, the
 * screen list and the editing drawer need three columns side by side. An explicit
 * explanation screen beats an interface that collapses.
 * The value matches the .admin-body breakpoint in admin.css.
 */
const MIN_CONSOLE_WIDTH = 900;

/* ---------- panel widths ---------- */

const SIDEBAR_KEY = 'admin:sidebar-width';
const DRAWER_KEY = 'admin:drawer-width';
const SIDEBAR_DEFAULT = 320;
const DRAWER_DEFAULT = 440;
const PANEL_MIN = 240;
const PANEL_MAX = 680;
/** The diagram is the primary surface — the panels are not allowed to swallow it */
const GRAPH_MIN = 360;

const clampWidth = (w: number, max: number) => Math.min(Math.max(w, PANEL_MIN), Math.max(PANEL_MIN, max));

/** A width saved on a wide screen must not swallow the diagram when the console opens on a narrow one */
function readWidth(key: string, fallback: number): number {
  let stored = fallback;
  try {
    const raw = Number(localStorage.getItem(key));
    if (Number.isFinite(raw) && raw > 0) stored = raw;
  } catch {
    /* Storage blocked — we stay with the default */
  }
  return clampWidth(stored, Math.min(PANEL_MAX, window.innerWidth - GRAPH_MIN));
}

function saveWidth(key: string, w: number) {
  try {
    localStorage.setItem(key, String(w));
  } catch {
    /* Private mode / storage blocked — the width simply is not remembered */
  }
}

/**
 * Measures the topbar's real height and feeds it to CSS as --topbar-h. The sticky
 * panels (list, diagram, drawer) compute their own height from it — a hard-coded
 * constant (49px) broke every time the bar grew by a pixel, and all the panels
 * overflowed past the bottom of the screen.
 */
function useMeasuredTopbar(): {
  appRef: RefObject<HTMLDivElement | null>;
  topbarRef: RefObject<HTMLElement | null>;
} {
  const appRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const app = appRef.current;
    const bar = topbarRef.current;
    if (!app || !bar) return;
    const apply = () => app.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  return { appRef, topbarRef };
}

function useTooNarrow(): boolean {
  const [tooNarrow, setTooNarrow] = useState(
    () => window.matchMedia(`(max-width: ${MIN_CONSOLE_WIDTH - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MIN_CONSOLE_WIDTH - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setTooNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return tooNarrow;
}

type Auth = { phase: 'checking' } | { phase: 'login' } | { phase: 'in'; email: string };

/** `/admin` → the list, `/admin/<slug>` → the editor, `/admin/<slug>/stats` → statistics. */
type Route = { view: 'list' } | { view: 'editor'; slug: string } | { view: 'stats'; slug: string };

function parseRoute(pathname: string): Route {
  const m = pathname.match(/^\/admin\/([^/]+)(\/stats)?\/?$/);
  if (!m) return { view: 'list' };
  const slug = decodeURIComponent(m[1]);
  if (!isValidSlug(slug)) return { view: 'list' };
  return m[2] ? { view: 'stats', slug } : { view: 'editor', slug };
}

export default function AdminApp() {
  const [auth, setAuth] = useState<Auth>({ phase: 'checking' });

  useEffect(() => {
    // Fires both on load (INITIAL_SESSION) and on the return from Google
    // (SIGNED_IN), because detectSessionInUrl picks the tokens out of the URL by
    // itself.
    //
    // supabase-js listens to visibilitychange on its own and broadcasts SIGNED_IN
    // on every return to the tab, even when the session has not changed. A fresh
    // state object on each such broadcast re-renders the whole console — and in
    // its wake useDraft reloads the draft from the server and wipes unsaved
    // edits. So the state object is replaced only when it has genuinely changed.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth((prev) => {
        if (!session) return prev.phase === 'login' ? prev : { phase: 'login' };
        const email = session.user.email ?? '';
        return prev.phase === 'in' && prev.email === email ? prev : { phase: 'in', email };
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // A stable identity: onAuthError is a dependency of reload in
  // useDraft/useSurveys, and a fresh closure on every AdminApp render would
  // trigger a reload of the draft.
  const onAuthError = useCallback(() => {
    void supabase.auth.signOut();
    setAuth({ phase: 'login' });
  }, []);

  if (auth.phase === 'checking') {
    return (
      <div className="admin-app">
        <div className="login-screen">
          <p className="a-hint">בודקים הרשאות…</p>
        </div>
      </div>
    );
  }

  if (auth.phase === 'login') {
    return (
      <div className="admin-app">
        <LoginScreen />
      </div>
    );
  }

  return <Console email={auth.email} onAuthError={onAuthError} />;
}

/** Navigation between the survey list and the editor, with no external router (two screens only). */
function Console({ email, onAuthError }: { email: string; onAuthError: () => void }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const surveys = useSurveys(onAuthError);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setRoute(parseRoute(path));
  }, []);

  if (route.view === 'list') {
    return (
      <div className="admin-app">
        <ConsoleTopbar email={email} />
        <div className="admin-scroll">
          <SurveyList
            surveys={surveys}
            onOpen={(slug) => navigate(`/admin/${slug}`)}
            onStats={(slug) => navigate(`/admin/${slug}/stats`)}
          />
        </div>
      </div>
    );
  }

  const survey = surveys.items.find((s) => s.slug === route.slug);

  if (route.view === 'stats') {
    return (
      <StatsPage
        key={route.slug}
        slug={route.slug}
        name={survey?.name ?? route.slug}
        email={email}
        onBack={() => navigate('/admin')}
        onOpenEditor={() => navigate(`/admin/${route.slug}`)}
        onAuthError={onAuthError}
      />
    );
  }

  return (
    <Editor
      key={route.slug}
      slug={route.slug}
      name={survey?.name ?? route.slug}
      archived={Boolean(survey?.archived_at)}
      // Analysis codes lock on the first publish. Until the list has loaded we do
      // not yet know whether this survey has been published — and then they lock:
      // an unnecessary lock is an annoyance, an unnecessary unlock rewrites a
      // code that collected data points at.
      codesLocked={survey ? survey.versions > 0 : true}
      email={email}
      onBack={() => {
        void surveys.reload();
        navigate('/admin');
      }}
      onStats={() => navigate(`/admin/${route.slug}/stats`)}
      onAuthError={onAuthError}
    />
  );
}

function ConsoleTopbar({ email }: { email: string }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>ניהול השאלונים</h1>
      </div>
      <div className="topbar-actions">
        <span className="topbar-user" title={email}>
          {email}
        </span>
        <button
          className="a-icon-btn"
          onClick={() => void supabase.auth.signOut()}
          aria-label="יציאה מהחשבון"
          title="יציאה מהחשבון"
        >
          <LogoutIcon />
        </button>
      </div>
    </header>
  );
}

function newScreen(type: Screen['type'], id: string): Screen {
  switch (type) {
    case 'info':
      return { id, type, title: '', body: '' };
    case 'consent':
      return { id, type, title: '', body: '', agreeLabel: 'אני מסכים/ה', declineLabel: 'לא מעוניין/ת' };
    case 'single':
    case 'multi':
      return { id, type, prompt: '', options: [{ id: 'opt_1', label: '' }] };
    case 'matrix':
      return {
        id,
        type,
        prompt: '',
        items: [{ id: 'item_1', label: '' }],
        scaleMin: 1,
        scaleMax: 5,
        minLabel: '',
        maxLabel: '',
      };
    case 'number':
      return { id, type, prompt: '' };
    case 'text':
      return { id, type, prompt: '' };
    case 'end':
      return { id, type, variant: 'complete', title: '', body: '' };
  }
}

interface EditorProps {
  slug: string;
  name: string;
  archived: boolean;
  /** Whether the analysis codes are already locked — that is, whether the survey has ever been published */
  codesLocked: boolean;
  email: string;
  onBack: () => void;
  onStats: () => void;
  onAuthError: () => void;
}

function Editor({
  slug,
  name,
  archived,
  codesLocked,
  email,
  onBack,
  onStats,
  onAuthError,
}: EditorProps) {
  const draft = useDraft(slug, onAuthError);
  const tooNarrow = useTooNarrow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null = the path check is off. An object (even an empty one) = it is open and
  // marking a path on the diagram.
  const [simAnswers, setSimAnswers] = useState<Answers | null>(null);
  // The quota state the check runs under — kept apart from the answers, because
  // it is not something the respondent answers
  const [simQuota, setSimQuota] = useState<Vars>({});
  const closeSim = useCallback(() => {
    setSimAnswers(null);
    setSimQuota({});
  }, []);
  const [sidebarW, setSidebarW] = useState(() => readWidth(SIDEBAR_KEY, SIDEBAR_DEFAULT));
  const [drawerW, setDrawerW] = useState(() => readWidth(DRAWER_KEY, DRAWER_DEFAULT));

  // Going back to the list with unsaved changes loses them — the same warning as leaving the page
  const leave = useCallback(() => {
    if (draft.dirty && !window.confirm('יש שינויים שלא נשמרו. לצאת בכל זאת ולאבד אותם?')) return;
    onBack();
  }, [draft.dirty, onBack]);

  // Selecting a screen from anywhere (diagram, list, validation panel) opens the editing drawer
  const selectScreen = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  // A selection made outside the diagram (the list, the validation panel, the
  // context block in the drawer, the path check) is also a "take me there"
  // request: in a 70-screen survey, highlighting a node that is off-screen helps
  // no one. A counter and not just an id — clicking the same link again brings
  // the view back to it.
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const focusNonce = useRef(0);
  const revealScreen = useCallback((id: string) => {
    setSelectedId(id);
    focusNonce.current += 1;
    setFocusRequest({ id, nonce: focusNonce.current });
  }, []);

  const config = draft.config;
  const issues = useMemo(() => (config ? validateConfig(config) : []), [config]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.length - errorCount;
  const { appRef, topbarRef } = useMeasuredTopbar();

  const selected = config?.screens.find((s) => s.id === selectedId) ?? null;

  // The limit is set against what is already taken: below 1280 the drawer floats
  // over the diagram rather than taking width from it, so there it does not count
  const takenBy = (w: number) => (window.innerWidth > 1280 ? w : 0);
  const clampSidebar = useCallback(
    (w: number) => clampWidth(w, Math.min(PANEL_MAX, window.innerWidth - GRAPH_MIN - takenBy(selected ? drawerW : 0))),
    [selected, drawerW],
  );
  const clampDrawer = useCallback(
    (w: number) => clampWidth(w, Math.min(PANEL_MAX, window.innerWidth - GRAPH_MIN - takenBy(sidebarOpen ? sidebarW : 0))),
    [sidebarOpen, sidebarW],
  );

  // The saved widths are enforced only while dragging — but a window narrowed
  // after load (or two panels that were saved wide) makes the grid wider than the
  // window, and in RTL the overflow spills to the left: the drawer is cut off at
  // the edge of the screen. So the effective width is recomputed on every render
  // against the window width: the drawer gives way first, then the list, and the
  // diagram keeps its minimum.
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  let sidebarEff = sidebarW;
  let drawerEff = drawerW;
  if (viewportW > 1280) {
    const room = viewportW - GRAPH_MIN;
    let overflow = (sidebarOpen ? sidebarW : 0) + (selected ? drawerW : 0) - room;
    if (overflow > 0 && selected) {
      const shrink = Math.min(overflow, Math.max(0, drawerW - PANEL_MIN));
      drawerEff = drawerW - shrink;
      overflow -= shrink;
    }
    if (overflow > 0 && sidebarOpen) sidebarEff = Math.max(PANEL_MIN, sidebarW - overflow);
  }

  const simPath = useMemo(
    () =>
      config && simAnswers
        ? simulatePath(config, simAnswers, simQuota).map((s) => s.screen.id)
        : null,
    [config, simAnswers, simQuota],
  );

  // The leave-with-unsaved-changes warning
  useEffect(() => {
    if (!draft.dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [draft.dirty]);

  // Keyboard shortcuts: Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or
  // Ctrl+Y redoes. Inside a text field we do not interfere — the browser's own
  // undo belongs there.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (draft.dirty && !draft.saving) void draft.save();
        return;
      }
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (typing) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        draft.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        draft.redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft]);

  // Stopping cycles before they happen: every edit (connecting, changing a
  // target, reordering, deleting) is first tried on a copy — if a new routing
  // cycle appears, the edit is not applied at all and an explanation showing the
  // cycle's path is displayed instead.
  const [cycleBlock, setCycleBlock] = useState<string | null>(null);
  const cycleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardedUpdate = useCallback(
    (fn: (cfg: SurveyConfig) => SurveyConfig) => {
      const cur = draft.config;
      if (cur) {
        const existing = new Set(
          validateConfig(cur).filter((i) => i.code === 'cycle').map((i) => i.message),
        );
        const created = validateConfig(fn(cur)).find(
          (i) => i.code === 'cycle' && !existing.has(i.message),
        );
        if (created) {
          setCycleBlock(created.message);
          if (cycleTimer.current) clearTimeout(cycleTimer.current);
          cycleTimer.current = setTimeout(() => setCycleBlock(null), 7000);
          return;
        }
      }
      draft.update(fn);
    },
    [draft],
  );

  const updateScreen = useCallback(
    (id: string, next: Screen) => {
      guardedUpdate((cfg) => ({
        ...cfg,
        screens: cfg.screens.map((s) => (s.id === id ? next : s)),
      }));
    },
    [guardedUpdate],
  );

  // The naming layer: every label the admin reads is derived from here, so it is built once
  const naming = useMemo(
    () => makeNaming(config ?? { version: '', screens: [] }),
    [config],
  );

  // A new mark is recorded at survey level and not on the screen — otherwise only
  // the screen that created it would know its name. A code rename (`renamedFrom`)
  // happens in that very same update: two separate actions would be two undo
  // entries, and either one alone leaves an inconsistent config.
  const defineVar = useCallback(
    (name: string, label: string, renamedFrom?: string) =>
      draft.update((cfg) =>
        defineVarIn(renamedFrom ? renameVar(cfg, renamedFrom, name) : cfg, name, label),
      ),
    [draft],
  );

  const defineVarValue = useCallback(
    (name: string, value: string, label: string, renamedFrom?: string) =>
      draft.update((cfg) =>
        defineVarValueIn(
          renamedFrom ? renameVarValue(cfg, name, renamedFrom, value) : cfg,
          name,
          value,
          label,
        ),
      ),
    [draft],
  );

  return (
    <div className="admin-app" ref={appRef}>
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-title">
          <button
            className="a-icon-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? 'הסתרת רשימת המסכים' : 'הצגת רשימת המסכים'}
            title={sidebarOpen ? 'הסתרת רשימת המסכים' : 'הצגת רשימת המסכים'}
          >
            <PanelIcon />
          </button>
          <button className="a-btn ghost small" onClick={leave} title="חזרה לרשימת השאלונים">
            → כל השאלונים
          </button>
          <button className="a-btn ghost small" onClick={onStats} title="סטטיסטיקות התשובות של השאלון">
            סטטיסטיקות
          </button>
          <h1>{name}</h1>
          <code className="topbar-slug" dir="ltr">
            {slug}
          </code>
          {archived && <span className="chip">בארכיון</span>}
        </div>
        <div className="topbar-status">
          {errorCount > 0 && (
            <span className="chip chip-error">
              <ErrorIcon width={13} height={13} />{' '}
              {errorCount === 1 ? 'שגיאה אחת' : `${errorCount} שגיאות`}
            </span>
          )}
          {warningCount > 0 && (
            <span className="chip chip-warning">
              <WarningIcon width={13} height={13} />{' '}
              {warningCount === 1 ? 'אזהרה אחת' : `${warningCount} אזהרות`}
            </span>
          )}
          {draft.dirty && <span className="chip chip-dirty">שינויים לא שמורים</span>}
        </div>
        <div className="topbar-actions">
          <button
            className="a-icon-btn"
            onClick={draft.undo}
            disabled={!draft.canUndo}
            aria-label="ביטול הפעולה האחרונה"
            title={`ביטול (${isMac ? '⌘Z' : 'Ctrl+Z'})`}
          >
            <UndoIcon />
          </button>
          <button
            className="a-icon-btn"
            onClick={draft.redo}
            disabled={!draft.canRedo}
            aria-label="ביצוע הפעולה מחדש"
            title={`ביצוע הפעולה מחדש (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`}
          >
            <RedoIcon />
          </button>
          <button
            className="a-btn secondary"
            onClick={() => void draft.save()}
            disabled={!draft.dirty || draft.saving || draft.phase !== 'ready'}
          >
            {draft.saving ? 'שומר…' : 'שמירה'}
          </button>
          <button
            className="a-btn secondary"
            onClick={() => setSettingsOpen(true)}
            disabled={draft.phase !== 'ready'}
            title="הגרלות A/B ומכסות משיבים — הגדרות שחלות על השאלון כולו ולא על מסך מסוים"
          >
            משתנים ומכסות
          </button>
          <button
            className={`a-btn ${simAnswers ? 'primary' : 'secondary'}`}
            onClick={() => (simAnswers ? closeSim() : setSimAnswers({}))}
            disabled={draft.phase !== 'ready'}
            title="לענות כמו משיב, ולראות בדיוק לאילו מסכים הוא יגיע"
          >
            בדיקת מסלול
          </button>
          <a
            className="a-btn secondary"
            href={surveyPath(slug)}
            target="_blank"
            rel="noreferrer"
            title="פתיחת השאלון כפי שהמשיבים רואים אותו — הגרסה האחרונה שפורסמה"
          >
            צפייה בשאלון
          </a>
          <button
            className="a-btn primary"
            onClick={() => setPublishOpen(true)}
            disabled={draft.phase !== 'ready'}
          >
            פרסום
          </button>
          <span className="topbar-user" title={email}>
            {email}
          </span>
          <button
            className="a-icon-btn"
            onClick={() => void supabase.auth.signOut()}
            aria-label="יציאה"
            title="יציאה"
          >
            <LogoutIcon />
          </button>
        </div>
      </header>

      {draft.phase === 'loading' && <div className="admin-empty">טוענים את הטיוטה…</div>}

      {draft.phase === 'error' && (
        <div className="admin-empty">
          <p>טעינת הטיוטה נכשלה.</p>
          <button className="a-btn primary" onClick={() => void draft.reload()}>
            ניסיון נוסף
          </button>
        </div>
      )}

      {draft.phase === 'forbidden' && (
        <div className="admin-empty">
          <p>
            החשבון הזה אינו מורשה — הכניסה מוגבלת לחשבונות Google של first-edea.com. אם התחברתם
            בעבר עם סיסמה, צאו והיכנסו מחדש עם Google.
          </p>
          <button className="a-btn primary" onClick={() => void supabase.auth.signOut()}>
            יציאה והתחברות עם Google
          </button>
        </div>
      )}

      {draft.phase === 'empty' && (
        <div className="admin-empty">
          <p>לשאלון הזה עדיין אין טיוטה. אפשר להתחיל משאלון הדגמה ולערוך אותו.</p>
          <button className="a-btn primary" onClick={() => void draft.createFromDemo()} disabled={draft.saving}>
            התחלה משאלון הדגמה
          </button>
        </div>
      )}

      {draft.phase === 'ready' && config && (
        <div
          className={`admin-body${sidebarOpen ? '' : ' sidebar-closed'}${selected ? ' drawer-open' : ''}`}
          style={{ '--sidebar-w': `${sidebarEff}px`, '--drawer-w': `${drawerEff}px` } as CSSProperties}
        >
          <aside className="admin-sidebar">
            <div className="admin-sidebar-scroll">
              <ScreenList
                screens={config.screens}
                naming={naming}
                selectedId={selectedId}
                issues={issues}
                onSelect={revealScreen}
                onReorder={(from, to) =>
                  guardedUpdate((cfg) => {
                    const screens = [...cfg.screens];
                    const [moved] = screens.splice(from, 1);
                    screens.splice(to, 0, moved);
                    return { ...cfg, screens };
                  })
                }
                onAdd={(type, id) => {
                  // A new screen cannot create a cycle, hence a direct update and not guardedUpdate
                  draft.update((cfg) => ({
                    ...cfg,
                    screens: insertScreen(cfg.screens, newScreen(type, id), selectedId),
                  }));
                  selectScreen(id);
                }}
              />
            </div>
            <PanelResizer
              edge="sidebar"
              width={sidebarEff}
              label="שינוי רוחב רשימת המסכים"
              clampWidth={clampSidebar}
              onWidth={(w, done) => {
                setSidebarW(w);
                if (done) saveWidth(SIDEBAR_KEY, w);
              }}
              onReset={() => {
                setSidebarW(SIDEBAR_DEFAULT);
                saveWidth(SIDEBAR_KEY, SIDEBAR_DEFAULT);
              }}
            />
          </aside>
          <main className="admin-main">
            <ValidationPanel issues={issues} naming={naming} onSelectScreen={revealScreen} />
            {simAnswers && (
              <Simulator
                config={config}
                naming={naming}
                answers={simAnswers}
                onAnswers={setSimAnswers}
                quotaFull={simQuota}
                onQuotaFull={setSimQuota}
                onSelect={revealScreen}
                onClose={closeSim}
              />
            )}
            <FlowGraph
              config={config}
              issues={issues}
              selectedId={selectedId}
              naming={naming}
              simPath={simPath}
              focusRequest={focusRequest}
              onSelect={selectScreen}
              onUpdate={guardedUpdate}
            />
          </main>
          {selected && (
            <aside className="editor-drawer" aria-label={`עריכת המסך ״${screenLabel(selected)}״`}>
              <PanelResizer
                edge="drawer"
                width={drawerEff}
                label="שינוי רוחב חלון העריכה"
                clampWidth={clampDrawer}
                onWidth={(w, done) => {
                  setDrawerW(w);
                  if (done) saveWidth(DRAWER_KEY, w);
                }}
                onReset={() => {
                  setDrawerW(DRAWER_DEFAULT);
                  saveWidth(DRAWER_KEY, DRAWER_DEFAULT);
                }}
              />
              <div className="drawer-head">
                <strong>עריכת מסך</strong>
                <button className="a-icon-btn" onClick={() => setSelectedId(null)} aria-label="סגירת העורך" title="סגירה">
                  <CloseIcon />
                </button>
              </div>
              <ScreenEditor
                key={selected.id}
                config={config}
                screen={selected}
                naming={naming}
                codesLocked={codesLocked}
                onSelect={revealScreen}
                onDefineVar={defineVar}
                onDefineVarValue={defineVarValue}
                onChange={(next) => updateScreen(selected.id, next)}
                onLaneShowIf={(ids, cond) => {
                  const targets = new Set(ids);
                  guardedUpdate((cfg) => ({
                    ...cfg,
                    screens: cfg.screens.map((s) =>
                      targets.has(s.id) ? ({ ...s, showIf: cond } as Screen) : s,
                    ),
                  }));
                }}
                onDelete={() => {
                  if (!window.confirm(`למחוק את המסך ״${screenLabel(selected)}״?`)) return;
                  guardedUpdate((cfg) => ({
                    ...cfg,
                    screens: cfg.screens.filter((s) => s.id !== selected.id),
                  }));
                  setSelectedId(null);
                }}
              />
            </aside>
          )}
        </div>
      )}

      {settingsOpen && config && (
        <SurveySettings
          config={config}
          naming={naming}
          codesLocked={codesLocked}
          onUpdate={draft.update}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {publishOpen && (
        <PublishDialog
          slug={slug}
          issues={issues}
          dirty={draft.dirty}
          onSave={draft.save}
          onClose={() => setPublishOpen(false)}
        />
      )}

      {(cycleBlock || draft.saveError) && (
        <div className="toast-stack">
          {cycleBlock && (
            <div className="cycle-toast" role="alert">
              <ErrorIcon width={16} height={16} />
              <div>
                <strong>הפעולה בוטלה — היא הייתה יוצרת לולאה שהמשיב לא יוכל לצאת ממנה</strong>
                <p>{cycleBlock}</p>
              </div>
              <button
                className="a-icon-btn"
                onClick={() => setCycleBlock(null)}
                aria-label="סגירת ההודעה"
              >
                <CloseIcon />
              </button>
            </div>
          )}
          {draft.saveError && (
            <div className="cycle-toast" role="alert">
              <ErrorIcon width={16} height={16} />
              <div>
                <strong>השמירה נכשלה</strong>
                <p>{draft.saveError}</p>
              </div>
              <button
                className="a-btn secondary small"
                onClick={() => void draft.save()}
                disabled={draft.saving}
              >
                {draft.saving ? 'שומר…' : 'ניסיון נוסף'}
              </button>
              <button
                className="a-icon-btn"
                onClick={draft.dismissSaveError}
                aria-label="סגירת ההודעה"
              >
                <CloseIcon />
              </button>
            </div>
          )}
        </div>
      )}

      {/* A layer on top rather than a replacement of the tree: narrowing the
          window mid-session will not tear the editor down or discard unsaved
          changes */}
      {tooNarrow && (
        <div className="narrow-notice" role="alert">
          <div className="narrow-notice-card">
            <h1>עריכת שאלון</h1>
            <p>
              העורך בנוי למסך רחב: תרשים הזרימה, רשימת המסכים ומגירת העריכה עובדים זה לצד זה
              וזקוקים לרוחב של {MIN_CONSOLE_WIDTH} פיקסלים לפחות.
            </p>
            <p>אפשר לפתוח אותו במחשב, או להרחיב את החלון — מה שערכתם נשאר פתוח כאן בינתיים.</p>
            <button className="a-btn secondary" onClick={leave}>
              → חזרה לרשימת השאלונים
            </button>
          </div>
        </div>
      )}

      {draft.conflict && config && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label="מישהו אחר שמר את הטיוטה">
            <header className="dialog-head">
              <h2>מישהו אחר שמר את הטיוטה</h2>
            </header>
            <p className="dialog-note">
              מאז שהטיוטה נטענה כאן, מישהו אחר שמר גרסה חדשה שלה. כדי לא למחוק את העבודה שלו,
              נטען עכשיו את הגרסה העדכנית — והשינויים שלא נשמרו כאן יאבדו.
            </p>
            <p className="dialog-note">
              לפני הטעינה מחדש אפשר להעתיק את הגרסה שעל המסך, כדי להשוות אליה או להעתיק ממנה
              חלקים בחזרה.
            </p>
            <footer className="dialog-actions">
              <CopyConfigButton config={config} />
              <button className="a-btn primary" onClick={() => void draft.reload()}>
                טעינה מחדש
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The only way out of the conflict dialog: the work on screen is about to be
 * discarded, and without this there is no way at all to rescue it.
 */
function CopyConfigButton({ config }: { config: SurveyConfig }) {
  const [state, setState] = useState<'idle' | 'copied' | 'downloaded'>('idle');

  async function rescue() {
    const json = JSON.stringify(config, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setState('copied');
    } catch {
      // A browser that blocks the clipboard — download a file instead. What matters is not losing the work.
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'survey-draft.json';
      link.click();
      URL.revokeObjectURL(url);
      setState('downloaded');
    }
  }

  const labels = {
    idle: 'העתקת הגרסה שעל המסך',
    copied: 'הועתקה ללוח ✓',
    downloaded: 'ירדה כקובץ ✓',
  };
  return (
    <button className="a-btn ghost" onClick={() => void rescue()}>
      {labels[state]}
    </button>
  );
}
