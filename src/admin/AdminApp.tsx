// קונסולת הניהול (/admin): שער כניסה (Supabase Auth, first-edea.com בלבד),
// ואחריו שני מסכים — רשימת השאלונים (/admin) ועורך של שאלון אחד
// (/admin/<slug>): רשימת מסכים עם גרירה, עורך מסך, ולידציה חיה, שמירה ופרסום.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Answers, Screen, SurveyConfig } from '../engine/types';
import { simulatePath } from '../engine/path';
import { validateConfig } from '../engine/validate';
import { isValidSlug, surveyPath } from '../data/surveys';
import { useDraft } from './useDraft';
import { useSurveys } from './useSurveys';
import { insertScreen } from './edits';
import { makeNaming } from './display';
import { LoginScreen } from './LoginScreen';
import { SurveyList } from './SurveyList';
import { supabase } from './supabaseClient';
import { ScreenList } from './ScreenList';
import { ScreenEditor } from './ScreenEditor';
import { FlowGraph } from './FlowGraph';
import { Simulator } from './Simulator';
import { ValidationPanel } from './ValidationPanel';
import { PublishDialog } from './PublishDialog';
import { CloseIcon, ErrorIcon, LogoutIcon, PanelIcon, RedoIcon, UndoIcon, WarningIcon } from './Icons';
import './admin.css';

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);

/**
 * מתחת לרוחב הזה הקונסולה לא נבנתה לעבוד: תרשים הזרימה, רשימת המסכים ומגירת
 * העריכה צריכים שלוש עמודות במקביל. עדיף מסך הסבר מפורש מאשר ממשק שקורס.
 * הערך תואם לנקודת השבירה של .admin-body ב-admin.css.
 */
const MIN_CONSOLE_WIDTH = 900;

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

/** ‎/admin‎ → רשימת השאלונים, ‎/admin/<slug>‎ → העורך של אותו שאלון. */
type Route = { view: 'list' } | { view: 'editor'; slug: string };

function parseRoute(pathname: string): Route {
  const m = pathname.match(/^\/admin\/([^/]+)\/?$/);
  if (!m) return { view: 'list' };
  const slug = decodeURIComponent(m[1]);
  return isValidSlug(slug) ? { view: 'editor', slug } : { view: 'list' };
}

export default function AdminApp() {
  const [auth, setAuth] = useState<Auth>({ phase: 'checking' });

  useEffect(() => {
    // נורה גם בטעינה (INITIAL_SESSION) וגם בחזרה מגוגל (SIGNED_IN),
    // כי detectSessionInUrl קולט את הטוקנים מה-URL בעצמו
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(session ? { phase: 'in', email: session.user.email ?? '' } : { phase: 'login' });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (auth.phase === 'checking') {
    return (
      <div className="admin-app">
        <div className="login-screen">
          <p className="a-hint">בודק הרשאות…</p>
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

  return (
    <Console
      email={auth.email}
      onAuthError={() => {
        void supabase.auth.signOut();
        setAuth({ phase: 'login' });
      }}
    />
  );
}

/** ניווט בין רשימת השאלונים לעורך, בלי ראוטר חיצוני (שני מסכים בלבד). */
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
          <SurveyList surveys={surveys} onOpen={(slug) => navigate(`/admin/${slug}`)} />
        </div>
      </div>
    );
  }

  const survey = surveys.items.find((s) => s.slug === route.slug);
  return (
    <Editor
      key={route.slug}
      slug={route.slug}
      name={survey?.name ?? route.slug}
      archived={Boolean(survey?.archived_at)}
      email={email}
      onBack={() => {
        void surveys.reload();
        navigate('/admin');
      }}
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
          aria-label="יציאה"
          title="יציאה"
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
  email: string;
  onBack: () => void;
  onAuthError: () => void;
}

function Editor({ slug, name, archived, email, onBack, onAuthError }: EditorProps) {
  const draft = useDraft(slug, onAuthError);
  const tooNarrow = useTooNarrow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  // null = ההרצה היבשה כבויה. אובייקט (גם ריק) = פתוחה ומסמנת מסלול בתרשים.
  const [simAnswers, setSimAnswers] = useState<Answers | null>(null);

  // חזרה לרשימה עם שינויים לא שמורים מאבדת אותם — אותה אזהרה כמו ביציאה מהדף
  const leave = useCallback(() => {
    if (draft.dirty && !window.confirm('יש שינויים שלא נשמרו. לצאת בכל זאת ולאבד אותם?')) return;
    onBack();
  }, [draft.dirty, onBack]);

  // בחירת מסך מכל מקום (תרשים, רשימה, פאנל ולידציה) פותחת את מגירת העריכה
  const selectScreen = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const config = draft.config;
  const issues = useMemo(() => (config ? validateConfig(config) : []), [config]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.length - errorCount;

  const selected = config?.screens.find((s) => s.id === selectedId) ?? null;

  const simPath = useMemo(
    () => (config && simAnswers ? simulatePath(config, simAnswers).map((s) => s.screen.id) : null),
    [config, simAnswers],
  );

  // אזהרת יציאה עם שינויים לא שמורים
  useEffect(() => {
    if (!draft.dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [draft.dirty]);

  // קיצורי מקלדת: Ctrl/Cmd+S שמירה, Ctrl/Cmd+Z ביטול, Ctrl/Cmd+Shift+Z או
  // Ctrl+Y חזרה. בתוך שדה טקסט לא מתערבים — שם פועל ה-undo של הדפדפן.
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

  // עצירת מעגלים לפני שהם קורים: כל עריכה (חיבור, שינוי יעד, סידור מחדש,
  // מחיקה) נבחנת קודם על עותק — אם נוצר מעגל ניתוב חדש, העריכה לא מוחלת
  // כלל ובמקומה מוצג הסבר עם מסלול המעגל.
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

  // שכבת השמות: כל תווית שהאדמין קורא נגזרת מכאן, ולכן היא נבנית פעם אחת
  const naming = useMemo(
    () => makeNaming(config ?? { version: '', screens: [] }),
    [config],
  );

  /** סימון חדש נרשם ברמת השאלון, לא על המסך — אחרת רק המסך שיצר אותו יידע את שמו. */
  const defineVar = useCallback(
    (name: string, label: string) => {
      draft.update((cfg) => ({
        ...cfg,
        varMeta: { ...cfg.varMeta, [name]: { ...cfg.varMeta?.[name], label } },
      }));
    },
    [draft],
  );

  const defineVarValue = useCallback(
    (name: string, value: string, label: string) => {
      draft.update((cfg) => {
        const existing = cfg.varMeta?.[name];
        return {
          ...cfg,
          varMeta: {
            ...cfg.varMeta,
            [name]: {
              label: existing?.label ?? name,
              values: { ...existing?.values, [value]: label },
            },
          },
        };
      });
    },
    [draft],
  );

  return (
    <div className="admin-app">
      <header className="topbar">
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
          <h1>{name}</h1>
          <code className="topbar-slug" dir="ltr">
            {slug}
          </code>
          {archived && <span className="chip">בארכיון</span>}
        </div>
        <div className="topbar-status">
          {errorCount > 0 && (
            <span className="chip chip-error">
              <ErrorIcon width={13} height={13} /> {errorCount} שגיאות
            </span>
          )}
          {warningCount > 0 && (
            <span className="chip chip-warning">
              <WarningIcon width={13} height={13} /> {warningCount} אזהרות
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
            aria-label="ביצוע מחדש"
            title={`ביצוע מחדש (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`}
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
            className={`a-btn ${simAnswers ? 'primary' : 'secondary'}`}
            onClick={() => setSimAnswers((a) => (a ? null : {}))}
            disabled={draft.phase !== 'ready'}
            title="לענות כמו משיב ולראות את המסלול שנוצר"
          >
            הרצה יבשה
          </button>
          <a
            className="a-btn secondary"
            href={surveyPath(slug)}
            target="_blank"
            rel="noreferrer"
            title="פתיחת השאלון כפי שהמשיבים רואים אותו (הגרסה שפורסמה)"
          >
            צפייה
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

      {draft.phase === 'loading' && <div className="admin-empty">טוען טיוטה…</div>}

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
            יצירת טיוטה מהדמו
          </button>
        </div>
      )}

      {draft.phase === 'ready' && config && (
        <div className={`admin-body${sidebarOpen ? '' : ' sidebar-closed'}${selected ? ' drawer-open' : ''}`}>
          <aside className="admin-sidebar">
            <ScreenList
              screens={config.screens}
              naming={naming}
              selectedId={selectedId}
              issues={issues}
              onSelect={selectScreen}
              onReorder={(from, to) =>
                guardedUpdate((cfg) => {
                  const screens = [...cfg.screens];
                  const [moved] = screens.splice(from, 1);
                  screens.splice(to, 0, moved);
                  return { ...cfg, screens };
                })
              }
              onAdd={(type, id) => {
                // מסך חדש לא יכול ליצור מעגל, ולכן update ישיר ולא guardedUpdate
                draft.update((cfg) => ({
                  ...cfg,
                  screens: insertScreen(cfg.screens, newScreen(type, id), selectedId),
                }));
                selectScreen(id);
              }}
            />
          </aside>
          <main className="admin-main">
            <ValidationPanel issues={issues} naming={naming} onSelectScreen={selectScreen} />
            {simAnswers && (
              <Simulator
                config={config}
                naming={naming}
                answers={simAnswers}
                onAnswers={setSimAnswers}
                onSelect={selectScreen}
                onClose={() => setSimAnswers(null)}
              />
            )}
            <FlowGraph
              config={config}
              issues={issues}
              selectedId={selectedId}
              naming={naming}
              simPath={simPath}
              onSelect={selectScreen}
              onUpdate={guardedUpdate}
            />
          </main>
          {selected && (
            <aside className="editor-drawer" aria-label={`עריכת המסך ${selected.id}`}>
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
                onSelect={selectScreen}
                onDefineVar={defineVar}
                onDefineVarValue={defineVarValue}
                onChange={(next) => updateScreen(selected.id, next)}
                onDelete={() => {
                  if (!window.confirm(`למחוק את המסך "${selected.id}"?`)) return;
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
                <strong>הפעולה נחסמה — היא הייתה יוצרת לולאה אינסופית</strong>
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

      {/* שכבה מעל ולא החלפה של העץ: הצרת החלון באמצע עבודה לא תפרק את העורך
          ולא תמחק שינויים שלא נשמרו */}
      {tooNarrow && (
        <div className="narrow-notice" role="alert">
          <div className="narrow-notice-card">
            <h1>עריכת שאלון</h1>
            <p>
              העורך בנוי למסך רחב: תרשים הזרימה, רשימת המסכים ומגירת העריכה עובדים זה לצד זה
              וזקוקים לרוחב של {MIN_CONSOLE_WIDTH} פיקסלים לפחות.
            </p>
            <p>אפשר לפתוח אותו במחשב, או להרחיב את החלון — העבודה שלכם נשמרת בינתיים.</p>
            <button className="a-btn secondary" onClick={leave}>
              → חזרה לרשימת השאלונים
            </button>
          </div>
        </div>
      )}

      {draft.conflict && config && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label="התנגשות שמירה">
            <header className="dialog-head">
              <h2>הטיוטה עודכנה במקביל</h2>
            </header>
            <p className="dialog-note">
              מישהו אחר שמר את הטיוטה מאז שנטענה. כדי לא לדרוס את השינויים שלו — נטען מחדש את
              הגרסה העדכנית. השינויים שלא נשמרו כאן יאבדו.
            </p>
            <p className="dialog-note">
              לפני הטעינה מחדש אפשר להעתיק את הגרסה שעל המסך, כדי להשוות אליה או לשחזר ממנה
              ידנית אחר כך.
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
 * מוצא יחיד מדיאלוג ההתנגשות: העבודה שעל המסך עומדת להימחק, ובלי זה אין שום
 * דרך להציל אותה.
 */
function CopyConfigButton({ config }: { config: SurveyConfig }) {
  const [state, setState] = useState<'idle' | 'copied' | 'downloaded'>('idle');

  async function rescue() {
    const json = JSON.stringify(config, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setState('copied');
    } catch {
      // דפדפן שחוסם את הלוח — מורידים קובץ במקום. העיקר שהעבודה לא תאבד.
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
    idle: 'העתקת ה-JSON שלי',
    copied: 'הועתק ✓',
    downloaded: 'הורד כקובץ ✓',
  };
  return (
    <button className="a-btn ghost" onClick={() => void rescue()}>
      {labels[state]}
    </button>
  );
}
