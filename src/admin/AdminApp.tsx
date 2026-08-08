// קונסולת הניהול (/admin): שער כניסה (Google, first-edea.com בלבד) ואז עורך
// הטיוטה — רשימת מסכים עם גרירה, עורך מסך, ולידציה חיה, שמירה ופרסום.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Screen, SurveyConfig } from '../engine/types';
import { validateConfig } from '../engine/validate';
import { getSession, logout } from './api';
import { useDraft } from './useDraft';
import { LoginScreen } from './LoginScreen';
import { ScreenList } from './ScreenList';
import { ScreenEditor } from './ScreenEditor';
import { FlowGraph } from './FlowGraph';
import { ValidationPanel } from './ValidationPanel';
import { PublishDialog } from './PublishDialog';
import { CloseIcon, ErrorIcon, LogoutIcon, PanelIcon, RedoIcon, UndoIcon, WarningIcon } from './Icons';
import './admin.css';

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);

type Auth = { phase: 'checking' } | { phase: 'login' } | { phase: 'in'; email: string };

export default function AdminApp() {
  const [auth, setAuth] = useState<Auth>({ phase: 'checking' });

  useEffect(() => {
    void getSession().then((s) => setAuth(s ? { phase: 'in', email: s.email } : { phase: 'login' }));
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
        <LoginScreen onLogin={(email) => setAuth({ phase: 'in', email })} />
      </div>
    );
  }
  return <Editor email={auth.email} onAuthError={() => setAuth({ phase: 'login' })} />;
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

function Editor({ email, onAuthError }: { email: string; onAuthError: () => void }) {
  const draft = useDraft(onAuthError);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);

  // בחירת מסך מכל מקום (תרשים, רשימה, פאנל ולידציה) פותחת את מגירת העריכה
  const selectScreen = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const config = draft.config;
  const issues = useMemo(() => (config ? validateConfig(config) : []), [config]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.length - errorCount;

  const selected = config?.screens.find((s) => s.id === selectedId) ?? null;

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

  const knownVars = useMemo(() => {
    if (!config) return [];
    const vars = new Set<string>(Object.keys(config.randomVars ?? {}));
    for (const s of config.screens) for (const r of s.onSubmit ?? []) vars.add(r.var);
    return [...vars];
  }, [config]);

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
          <h1>ניהול השאלון</h1>
          {config && (
            <span className="a-hint" dir="ltr">
              {config.version}
            </span>
          )}
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
            onClick={() => void logout().then(onAuthError)}
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

      {draft.phase === 'empty' && (
        <div className="admin-empty">
          <p>עדיין אין טיוטה. אפשר להתחיל משאלון הדגמה ולערוך אותו.</p>
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
                draft.update((cfg) => ({ ...cfg, screens: [...cfg.screens, newScreen(type, id)] }));
                selectScreen(id);
              }}
            />
          </aside>
          <main className="admin-main">
            <ValidationPanel issues={issues} onSelectScreen={selectScreen} />
            <FlowGraph
              config={config}
              issues={issues}
              selectedId={selectedId}
              vars={knownVars}
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
                screen={selected}
                screens={config.screens}
                vars={knownVars}
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
        <PublishDialog issues={issues} dirty={draft.dirty} onClose={() => setPublishOpen(false)} />
      )}

      {cycleBlock && (
        <div className="cycle-toast" role="alert">
          <ErrorIcon width={16} height={16} />
          <div>
            <strong>הפעולה נחסמה — היא הייתה יוצרת לולאה אינסופית</strong>
            <p>{cycleBlock}</p>
          </div>
          <button className="a-icon-btn" onClick={() => setCycleBlock(null)} aria-label="סגירת ההודעה">
            <CloseIcon />
          </button>
        </div>
      )}

      {draft.conflict && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label="התנגשות שמירה">
            <header className="dialog-head">
              <h2>הטיוטה עודכנה במקביל</h2>
            </header>
            <p className="dialog-note">
              מישהו אחר שמר את הטיוטה מאז שנטענה. כדי לא לדרוס את השינויים שלו — נטען מחדש את
              הגרסה העדכנית. השינויים שלא נשמרו כאן יאבדו.
            </p>
            <footer className="dialog-actions">
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
