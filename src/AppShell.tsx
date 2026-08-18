// The survey's loading shell: it fetches the config (with the version pinned to
// the session) and only then renders App. Four states: loading / survey not
// found / survey closed / a temporary fault with a retry.
//
// The distinction between "closed" and "fault" matters: a respondent holding a
// link to an archived survey needs to know there is no point retrying, and a
// respondent on a bad network needs exactly the opposite.

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
    // slug === null — the path itself is malformed (`/s/…` with an invalid id)
    if (!slug) {
      setState({ phase: 'error', kind: 'missing' });
      return;
    }
    setState({ phase: 'loading' });
    // Both requests in parallel: the quota state does not depend on the config,
    // and running them in series would add a whole network round trip before the
    // first screen. The counts fail silently (fail open), so Promise.all will not
    // reject because of them — only the config load can fail here.
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
