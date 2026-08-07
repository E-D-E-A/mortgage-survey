// ניהול מצב הטיוטה בקונסולה: טעינה, עריכה בזיכרון (dirty), היסטוריית
// undo/redo, שמירה עם נעילה אופטימית (409 ⇒ conflict), ויצירת טיוטה
// ראשונה משאלון הדגמה.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/placeholder';
import { ConflictError, UnauthorizedError, getDraft, saveDraft } from './api';

export type DraftPhase = 'loading' | 'empty' | 'ready' | 'error';

/** עומק ההיסטוריה; עריכות צפופות (הקלדה) מתאחדות לצעד undo אחד */
const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

export interface Draft {
  phase: DraftPhase;
  config: SurveyConfig | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** עדכון הקונפיג בזיכרון (מסמן dirty ונרשם בהיסטוריה) */
  update: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
  createFromDemo: () => Promise<void>;
  reload: () => Promise<void>;
}

// הקונפיג אימיוטבילי — כל עריכה יוצרת אובייקט חדש, ולכן ההיסטוריה שומרת
// הפניות בלבד (זול), ו-undo משחזר את אותם אובייקטים עצמם.
interface EditState {
  config: SurveyConfig | null;
  past: SurveyConfig[];
  future: SurveyConfig[];
}

export function useDraft(onAuthError: () => void): Draft {
  const [phase, setPhase] = useState<DraftPhase>('loading');
  const [edit, setEdit] = useState<EditState>({ config: null, past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const updatedAtRef = useRef<string | null>(null);
  /** מה ששמור בשרת — undo שמגיע בדיוק אליו מנקה את סימון ה-dirty */
  const savedRef = useRef<SurveyConfig | null>(null);
  const lastEditAt = useRef(0);

  const reload = useCallback(async () => {
    setPhase('loading');
    setConflict(false);
    try {
      const draft = await getDraft();
      updatedAtRef.current = draft.updated_at;
      savedRef.current = draft.config;
      setEdit({ config: draft.config, past: [], future: [] });
      setDirty(false);
      setPhase(draft.config ? 'ready' : 'empty');
    } catch (e) {
      if (e instanceof UnauthorizedError) onAuthError();
      setPhase('error');
    }
  }, [onAuthError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback((fn: (cfg: SurveyConfig) => SurveyConfig) => {
    // החלטת האיחוד נלקחת מחוץ ל-updater — הוא חייב להישאר טהור (StrictMode
    // מריץ אותו פעמיים)
    const now = Date.now();
    const coalesce = now - lastEditAt.current < COALESCE_MS;
    lastEditAt.current = now;
    setEdit((s) => {
      if (!s.config) return s;
      const next = fn(s.config);
      if (next === s.config) return s;
      const past = coalesce ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), s.config];
      return { config: next, past, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastEditAt.current = 0;
    setEdit((s) => {
      if (s.past.length === 0 || !s.config) return s;
      return {
        config: s.past[s.past.length - 1],
        past: s.past.slice(0, -1),
        future: [...s.future, s.config],
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastEditAt.current = 0;
    setEdit((s) => {
      if (s.future.length === 0 || !s.config) return s;
      return {
        config: s.future[s.future.length - 1],
        past: [...s.past, s.config],
        future: s.future.slice(0, -1),
      };
    });
  }, []);

  // dirty = הקונפיג הנוכחי שונה מהשמור (השוואת הפניות מספיקה: undo משחזר
  // את אותו אובייקט שנטען/נשמר)
  useEffect(() => {
    if (edit.config !== null) setDirty(edit.config !== savedRef.current);
  }, [edit.config]);

  const save = useCallback(async (): Promise<boolean> => {
    const config = edit.config;
    if (!config) return false;
    setSaving(true);
    try {
      const { updated_at } = await saveDraft(config, updatedAtRef.current);
      updatedAtRef.current = updated_at;
      savedRef.current = config;
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof ConflictError) setConflict(true);
      else if (e instanceof UnauthorizedError) onAuthError();
      return false;
    } finally {
      setSaving(false);
    }
  }, [edit.config, onAuthError]);

  const createFromDemo = useCallback(async () => {
    setSaving(true);
    try {
      const { updated_at } = await saveDraft(questionnaire, null);
      updatedAtRef.current = updated_at;
      savedRef.current = questionnaire;
      setEdit({ config: questionnaire, past: [], future: [] });
      setDirty(false);
      setPhase('ready');
    } catch (e) {
      if (e instanceof ConflictError) await reload();
      else if (e instanceof UnauthorizedError) onAuthError();
    } finally {
      setSaving(false);
    }
  }, [onAuthError, reload]);

  return {
    phase,
    config: edit.config,
    dirty,
    saving,
    conflict,
    canUndo: edit.past.length > 0,
    canRedo: edit.future.length > 0,
    update,
    undo,
    redo,
    save,
    createFromDemo,
    reload,
  };
}
