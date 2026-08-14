// The survey list in the console: loading and management actions (create,
// rename, archive, delete). Every action ends with a reload of the list — it is
// the single source of truth, and especially so for versions, which decides
// whether deletion is possible at all.

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  ForbiddenError,
  UnauthorizedError,
  createSurvey,
  deleteSurvey,
  listSurveys,
  updateSurvey,
  type SurveySummary,
} from './api';

export type SurveysPhase = 'loading' | 'ready' | 'error' | 'forbidden';

export interface Surveys {
  phase: SurveysPhase;
  items: SurveySummary[];
  busy: boolean;
  /** An action failure (not a load failure) — text to display, or null */
  error: string | null;
  dismissError: () => void;
  reload: () => Promise<void>;
  create: (slug: string, name: string) => Promise<boolean>;
  rename: (slug: string, name: string) => Promise<boolean>;
  setArchived: (slug: string, archived: boolean) => Promise<boolean>;
  remove: (slug: string) => Promise<boolean>;
}

function describe(e: unknown, action: 'create' | 'delete' | 'other'): string {
  if (e instanceof ApiError) {
    if (e.status === 409 && action === 'create') return 'המזהה הזה כבר תפוס — בחרו מזהה אחר';
    if (e.status === 409 && action === 'delete') {
      return 'אי אפשר למחוק שאלון שכבר פורסם — אפשר להעביר אותו לארכיון במקום';
    }
    if (e.status === 404) return 'השאלון לא נמצא — ייתכן שמישהו מחק אותו. רעננו את הרשימה.';
    if (e.status === 400) return 'הפרטים לא תקינים — בדקו את השם ואת המזהה';
    return `הפעולה נכשלה (קוד ${e.status}) — נסו שוב`;
  }
  return 'הפעולה נכשלה — אין תקשורת עם השרת. נסו שוב.';
}

export function useSurveys(onAuthError: () => void): Surveys {
  const [phase, setPhase] = useState<SurveysPhase>('loading');
  const [items, setItems] = useState<SurveySummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listSurveys());
      setPhase('ready');
    } catch (e) {
      if (e instanceof UnauthorizedError) onAuthError();
      setPhase(e instanceof ForbiddenError ? 'forbidden' : 'error');
    }
  }, [onAuthError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: 'create' | 'delete' | 'other', fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await reload();
        return true;
      } catch (e) {
        if (e instanceof UnauthorizedError) onAuthError();
        else if (e instanceof ForbiddenError) setPhase('forbidden');
        else setError(describe(e, action));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onAuthError, reload],
  );

  return {
    phase,
    items,
    busy,
    error,
    dismissError: () => setError(null),
    reload,
    create: (slug, name) => run('create', () => createSurvey(slug, name)),
    rename: (slug, name) => run('other', () => updateSurvey(slug, { name })),
    setArchived: (slug, archived) => run('other', () => updateSurvey(slug, { archived })),
    remove: (slug) => run('delete', () => deleteSurvey(slug)),
  };
}
