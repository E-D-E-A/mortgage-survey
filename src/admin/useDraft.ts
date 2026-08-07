// ניהול מצב הטיוטה בקונסולה: טעינה, עריכה בזיכרון (dirty), שמירה עם נעילה
// אופטימית (409 ⇒ conflict), ויצירת טיוטה ראשונה משאלון הדגמה.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/placeholder';
import { ConflictError, UnauthorizedError, getDraft, saveDraft } from './api';

export type DraftPhase = 'loading' | 'empty' | 'ready' | 'error';

export interface Draft {
  phase: DraftPhase;
  config: SurveyConfig | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  /** עדכון הקונפיג בזיכרון (מסמן dirty) */
  update: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
  save: () => Promise<boolean>;
  createFromDemo: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useDraft(onAuthError: () => void): Draft {
  const [phase, setPhase] = useState<DraftPhase>('loading');
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const updatedAtRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setPhase('loading');
    setConflict(false);
    try {
      const draft = await getDraft();
      updatedAtRef.current = draft.updated_at;
      setConfig(draft.config);
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
    setConfig((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!config) return false;
    setSaving(true);
    try {
      const { updated_at } = await saveDraft(config, updatedAtRef.current);
      updatedAtRef.current = updated_at;
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof ConflictError) setConflict(true);
      else if (e instanceof UnauthorizedError) onAuthError();
      return false;
    } finally {
      setSaving(false);
    }
  }, [config, onAuthError]);

  const createFromDemo = useCallback(async () => {
    setSaving(true);
    try {
      const { updated_at } = await saveDraft(questionnaire, null);
      updatedAtRef.current = updated_at;
      setConfig(questionnaire);
      setDirty(false);
      setPhase('ready');
    } catch (e) {
      if (e instanceof ConflictError) await reload();
      else if (e instanceof UnauthorizedError) onAuthError();
    } finally {
      setSaving(false);
    }
  }, [onAuthError, reload]);

  return { phase, config, dirty, saving, conflict, update, save, createFromDemo, reload };
}
