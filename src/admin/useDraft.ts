// Managing one survey's draft state in the console: loading, in-memory editing
// (dirty), undo/redo history, saving with optimistic locking (409 ⇒ conflict),
// and creating the first draft from the demo survey.
// Every call takes the slug — the console manages several surveys.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/survey-v1';
import { sameShape } from './edits';
import {
  ConflictError,
  ForbiddenError,
  SaveFailedError,
  UnauthorizedError,
  getDraft,
  saveDraft,
} from './api';

/**
 * Wording a save failure for the editor. Silence here is the worst case: the
 * "unsaved changes" chip stays put, the button goes live again, and the editor
 * assumes the save went through.
 */
function describeSaveFailure(e: unknown): string {
  if (e instanceof SaveFailedError) {
    if (e.status === 422) return 'השרת מצא שגיאות בטיוטה ולכן לא שמר אותה. תקנו אותן ונסו שוב.';
    if (e.status >= 500) return `השמירה נכשלה בגלל תקלה בשרת (קוד ${e.status}). השינויים עדיין כאן — נסו שוב.`;
    return `השמירה נכשלה (קוד ${e.status}). השינויים עדיין כאן — נסו שוב.`;
  }
  return 'השמירה נכשלה — אין תקשורת עם השרת. השינויים עדיין כאן; נסו שוב.';
}

/** 'forbidden' — signed in, but the account is not on the permitted domain (as distinct from a general error) */
export type DraftPhase = 'loading' | 'empty' | 'ready' | 'error' | 'forbidden';

/**
 * The history depth; continuous typing coalesces into a single undo step.
 *
 * "Continuous" is a matter of kind as well as of time: the time window alone also
 * merged two button presses made one after the other (adding an option and then
 * deleting a row), and a single undo wiped out both. So coalescing is also
 * conditioned on sameShape — only an edit that did not change the config's shape
 * counts as a continuation of the one before it.
 */
const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

export interface Draft {
  phase: DraftPhase;
  config: SurveyConfig | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  /** A save failure that is neither a conflict nor an auth problem — text to show the editor, or null */
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Updates the config in memory (marks it dirty and records it in the history) */
  update: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
  createFromDemo: () => Promise<void>;
  reload: () => Promise<void>;
  dismissSaveError: () => void;
}

// The config is immutable — every edit creates a new object, so the history
// keeps references only (cheap), and undo restores those very same objects.
interface EditState {
  config: SurveyConfig | null;
  past: SurveyConfig[];
  future: SurveyConfig[];
}

export function useDraft(slug: string, onAuthError: () => void): Draft {
  const [phase, setPhase] = useState<DraftPhase>('loading');
  const [edit, setEdit] = useState<EditState>({ config: null, past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const updatedAtRef = useRef<string | null>(null);
  /** What is saved on the server — an undo that lands exactly on it clears the dirty flag */
  const savedRef = useRef<SurveyConfig | null>(null);
  const lastEditAt = useRef(0);

  const reload = useCallback(async () => {
    setPhase('loading');
    setConflict(false);
    setSaveError(null);
    try {
      const draft = await getDraft(slug);
      updatedAtRef.current = draft.updated_at;
      savedRef.current = draft.config;
      setEdit({ config: draft.config, past: [], future: [] });
      setDirty(false);
      setPhase(draft.config ? 'ready' : 'empty');
    } catch (e) {
      if (e instanceof UnauthorizedError) onAuthError();
      setPhase(e instanceof ForbiddenError ? 'forbidden' : 'error');
    }
  }, [slug, onAuthError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback((fn: (cfg: SurveyConfig) => SurveyConfig) => {
    // The coalescing decision is taken outside the updater — it has to stay pure
    // (StrictMode runs it twice)
    const now = Date.now();
    const recent = now - lastEditAt.current < COALESCE_MS;
    lastEditAt.current = now;
    setEdit((s) => {
      if (!s.config) return s;
      const next = fn(s.config);
      if (next === s.config) return s;
      const coalesce = recent && sameShape(s.config, next);
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

  // dirty = the current config differs from the saved one (a reference comparison
  // is enough: undo restores the very object that was loaded or saved)
  useEffect(() => {
    if (edit.config !== null) setDirty(edit.config !== savedRef.current);
  }, [edit.config]);

  const save = useCallback(async (): Promise<boolean> => {
    const config = edit.config;
    if (!config) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const { updated_at } = await saveDraft(slug, config, updatedAtRef.current);
      updatedAtRef.current = updated_at;
      savedRef.current = config;
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof ConflictError) setConflict(true);
      else if (e instanceof UnauthorizedError) onAuthError();
      else if (e instanceof ForbiddenError) setPhase('forbidden');
      else setSaveError(describeSaveFailure(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [slug, edit.config, onAuthError]);

  const createFromDemo = useCallback(async () => {
    setSaving(true);
    try {
      const { updated_at } = await saveDraft(slug, questionnaire, null);
      updatedAtRef.current = updated_at;
      savedRef.current = questionnaire;
      setEdit({ config: questionnaire, past: [], future: [] });
      setDirty(false);
      setPhase('ready');
    } catch (e) {
      if (e instanceof ConflictError) await reload();
      else if (e instanceof UnauthorizedError) onAuthError();
      else if (e instanceof ForbiddenError) setPhase('forbidden');
      else setSaveError(describeSaveFailure(e));
    } finally {
      setSaving(false);
    }
  }, [slug, onAuthError, reload]);

  return {
    phase,
    config: edit.config,
    dirty,
    saving,
    conflict,
    saveError,
    canUndo: edit.past.length > 0,
    canRedo: edit.future.length > 0,
    update,
    undo,
    redo,
    save,
    createFromDemo,
    reload,
    dismissSaveError: () => setSaveError(null),
  };
}
