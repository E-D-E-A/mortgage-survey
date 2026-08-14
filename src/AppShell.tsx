// מעטפת טעינה לשאלון: מביאה את הקונפיג (עם הצמדת גרסה לסשן) ורק אז
// מרנדרת את App. ארבעה מצבים: טוען / שאלון שלא נמצא / שאלון שנסגר /
// תקלה זמנית עם ניסיון חוזר.
//
// ההבחנה בין "נסגר" ל"תקלה" חשובה: משיב שקיבל קישור לשאלון מאורכב צריך
// לדעת שאין מה לנסות שוב, ומשיב עם רשת גרועה צריך בדיוק את ההפך.

import { useCallback, useEffect, useState } from 'react';
import App from './App';
import { ConfigLoadError, loadConfig, type LoadFailure } from './data/config';
import { fetchQuotaCounts } from './data/quota';
import { quotaVars } from './engine/quota';
import type { SurveyConfig, Vars } from './engine/types';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; kind: LoadFailure }
  | { phase: 'ready'; config: SurveyConfig; quota: Vars };

const MESSAGES: Record<LoadFailure, { title: string; body: string; retry: boolean }> = {
  closed: {
    title: 'השאלון נסגר',
    body: 'השאלון הזה כבר לא פעיל. תודה על העניין!',
    retry: false,
  },
  missing: {
    title: 'השאלון לא נמצא',
    body: 'ייתכן שהקישור שגוי או שהשאלון עדיין לא פורסם. כדאי לבדוק את הקישור מול מי ששלח אותו.',
    retry: false,
  },
  network: {
    title: 'משהו השתבש',
    body: 'לא הצלחנו לטעון את השאלון. בדקו את החיבור ונסו שוב.',
    retry: true,
  },
};

export default function AppShell({ slug }: { slug: string | null }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const load = useCallback(() => {
    // slug === null — הנתיב עצמו פגום (‎/s/…‎ עם מזהה לא חוקי)
    if (!slug) {
      setState({ phase: 'error', kind: 'missing' });
      return;
    }
    setState({ phase: 'loading' });
    // שתי הבקשות במקביל: מצב המכסות אינו תלוי בקונפיג, וסידור טורי היה מוסיף
    // סיבוב רשת שלם לפני המסך הראשון. הספירות נכשלות בשקט (fail open) ולכן
    // Promise.all לא ייפול בגללן — רק טעינת הקונפיג יכולה להיכשל כאן.
    Promise.all([loadConfig(slug), fetchQuotaCounts(slug)])
      .then(([config, counts]) =>
        setState({ phase: 'ready', config, quota: quotaVars(config, counts) }),
      )
      .catch((e) =>
        setState({
          phase: 'error',
          kind: e instanceof ConfigLoadError ? e.kind : 'network',
        }),
      );
  }, [slug]);

  useEffect(load, [load]);

  if (state.phase === 'ready') return <App config={state.config} quota={state.quota} />;

  const message = state.phase === 'error' ? MESSAGES[state.kind] : null;

  return (
    <div className="app">
      <main className="card">
        <div className="screen center">
          {!message ? (
            <p className="help">טוען שאלון…</p>
          ) : (
            <>
              <h1>{message.title}</h1>
              <p className="help">{message.body}</p>
              {message.retry && (
                <button className="btn primary" onClick={load}>
                  ניסיון נוסף
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
