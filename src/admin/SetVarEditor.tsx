// The onSubmit rules editor: marking the respondent after they answer ("the
// respondent's track = track A"), so that later screens can open based on it.
//
// The admin writes no variable names and no value codes here — they pick from a
// list, and create new ones through a form that asks first for a Hebrew label and
// only then for the analysis code. The totality warning (a stale value after
// navigating back) is surfaced in the validation panel.

import { useState } from 'react';
import type { SetVarRule } from '../engine/types';
import type { Naming } from './display';
import { varLabel, varValueLabel } from './display';
import { OptionalCondition } from './ConditionBuilder';
import { DefineForm, nextCode } from './DefineForm';
import { PencilIcon, TrashIcon } from './Icons';

interface Props {
  rules: SetVarRule[];
  onChange: (rules: SetVarRule[] | undefined) => void;
  naming: Naming;
  /** The analysis codes are locked — that is, the survey has been published at least once */
  codesLocked: boolean;
  /**
   * Creates a new mark at survey level (varMeta), so every screen sees it by its
   * name. `renamedFrom` — the previous code, when it was changed: every
   * reference to it is updated along with the name.
   */
  onDefineVar: (name: string, label: string, renamedFrom?: string) => void;
  onDefineVarValue: (name: string, value: string, label: string, renamedFrom?: string) => void;
}

const NEW = '__new__';

export function SetVarEditor({
  rules,
  onChange,
  naming,
  codesLocked,
  onDefineVar,
  onDefineVarValue,
}: Props) {
  const emit = (next: SetVarRule[]) => onChange(next.length > 0 ? next : undefined);
  const [creating, setCreating] = useState<
    { index: number; field: 'var' | 'value'; renaming?: string } | null
  >(null);

  function patch(i: number, rule: SetVarRule) {
    emit(rules.map((r, j) => (j === i ? rule : r)));
  }

  return (
    <div className="a-field">
      {rules.length === 0 && (
        <p className="ed-empty">
          המסך הזה לא מסמן דבר. סימון נשאר על המשיב לכל אורך השאלון, ומסכים
          שבאים אחריו יכולים להופיע רק למי שמסומן כך.
        </p>
      )}
      {rules.map((rule, i) => {
        const values = Object.entries(naming.varMeta[rule.var]?.values ?? {});
        const current = String(rule.value ?? '');
        return (
          <div className="rule-card" key={i}>
            <div className="rule-head">
              <span className="rule-index">{i + 1}</span>
              <select
                className="a-select"
                value={rule.var}
                onChange={(e) => {
                  if (e.target.value === NEW) return setCreating({ index: i, field: 'var' });
                  patch(i, { ...rule, var: e.target.value, value: '' });
                }}
                aria-label="הסימון שנקבע כאן"
                title={rule.var}
              >
                {!naming.vars.includes(rule.var) && (
                  <option value={rule.var}>{varLabel(naming, rule.var)}</option>
                )}
                {naming.vars.map((v) => (
                  <option key={v} value={v}>
                    {varLabel(naming, v)}
                  </option>
                ))}
                <option value={NEW}>+ יצירת סימון חדש…</option>
              </select>
              <button
                className="a-icon-btn"
                onClick={() => setCreating({ index: i, field: 'var', renaming: rule.var })}
                title="שינוי השם שמוצג לסימון"
                aria-label="שינוי השם שמוצג לסימון"
                disabled={!rule.var}
              >
                <PencilIcon />
              </button>
              <span className="a-label">=</span>
              <select
                className="a-select"
                value={current}
                onChange={(e) => {
                  if (e.target.value === NEW) return setCreating({ index: i, field: 'value' });
                  patch(i, { ...rule, value: e.target.value });
                }}
                aria-label="הערך שנקבע לסימון"
                title={current}
              >
                {!values.some(([id]) => id === current) && (
                  <option value={current}>{current ? varValueLabel(naming, rule.var, current) : '— בחרו ערך —'}</option>
                )}
                {values.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
                <option value={NEW}>+ יצירת ערך חדש…</option>
              </select>
              <button
                className="a-icon-btn"
                onClick={() => setCreating({ index: i, field: 'value', renaming: current })}
                title="שינוי השם שמוצג לערך"
                aria-label="שינוי השם שמוצג לערך"
                disabled={!current}
              >
                <PencilIcon />
              </button>
              <button
                className="a-icon-btn danger"
                onClick={() => emit(rules.filter((_, j) => j !== i))}
                aria-label="מחיקת הסימון הזה"
              >
                <TrashIcon />
              </button>
            </div>

            {creating?.index === i && (
              <DefineForm
                // Keyed by what is being edited: the form initialises from the
                // existing values, so it has to be rebuilt when moving to a
                // different field or a different mark
                key={`${creating.field}-${creating.renaming ?? 'new'}`}
                kind={creating.field}
                renaming={Boolean(creating.renaming)}
                codeLocked={codesLocked}
                suggestedCode={
                  creating.renaming ??
                  (creating.field === 'var'
                    ? nextCode('mark', naming.vars)
                    : nextCode('v', values.map(([id]) => id)))
                }
                suggestedLabel={
                  creating.renaming
                    ? creating.field === 'var'
                      ? naming.varMeta[creating.renaming]?.label ?? ''
                      : naming.varMeta[rule.var]?.values?.[creating.renaming] ?? ''
                    : ''
                }
                takenCodes={
                  creating.field === 'var' ? naming.vars : values.map(([id]) => id)
                }
                onCancel={() => setCreating(null)}
                onCreate={(code, label) => {
                  // The rule is only touched when defining something new:
                  // editing an existing definition has already updated every
                  // reference to it, and writing again here would overwrite that
                  // with a stale copy of the screen
                  const from = creating.renaming;
                  if (creating.field === 'var') {
                    onDefineVar(code, label, from);
                    if (!from) patch(i, { ...rule, var: code, value: '' });
                  } else {
                    onDefineVarValue(rule.var, code, label, from);
                    if (!from) patch(i, { ...rule, value: code });
                  }
                  setCreating(null);
                }}
              />
            )}

            <OptionalCondition
              label="מסמנים רק אם…"
              value={rule.if}
              onChange={(cond) => {
                const next: SetVarRule = { var: rule.var, value: rule.value };
                patch(i, cond ? { ...next, if: cond } : next);
              }}
              naming={naming}
            />
          </div>
        );
      })}
    </div>
  );
}

