// מעטפת טעינה לשאלון: מביאה את הקונפיג (עם הצמדת גרסה לסשן) ורק אז
// מרנדרת את App. שלושה מצבים: טוען / שגיאה עם ניסיון חוזר / מוכן.

import { useCallback, useEffect, useState } from 'react';
import App from './App';
import { loadConfig } from './data/config';
import type { SurveyConfig } from './engine/types';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; config: SurveyConfig };

export default function AppShell() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const load = useCallback(() => {
    setState({ phase: 'loading' });
    loadConfig()
      .then((config) => setState({ phase: 'ready', config }))
      .catch(() => setState({ phase: 'error' }));
  }, []);

  useEffect(load, [load]);

  if (state.phase === 'ready') return <App config={state.config} />;

  return (
    <div className="app">
      <main className="card">
        <div className="screen center">
          {state.phase === 'loading' ? (
            <p className="help">טוען שאלון…</p>
          ) : (
            <>
              <h1>משהו השתבש</h1>
              <p className="help">לא הצלחנו לטעון את השאלון. בדקו את החיבור ונסו שוב.</p>
              <button className="btn primary" onClick={load}>
                ניסיון נוסף
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
