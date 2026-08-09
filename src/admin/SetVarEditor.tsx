// עורך כללי onSubmit: סימון המשיב אחרי שהוא עונה ("מסלול המשיב = מסלול A"),
// כדי שמסכים מאוחרים יוכלו להיפתח לפיו.
//
// האדמין לא כותב כאן שמות משתנים ולא קודי ערכים — הוא בוחר מרשימה, ויוצר
// חדשים דרך טופס שמבקש קודם תווית בעברית ורק אחריה את הקוד לאנליזה.
// אזהרת הטוטאליות (ערך ישן אחרי ניווט אחורה) מוצגת בפאנל השגיאות.

import { useState } from 'react';
import type { SetVarRule } from '../engine/types';
import type { Naming } from './display';
import { varLabel, varValueLabel } from './display';
import { OptionalCondition } from './ConditionBuilder';
import { PencilIcon, TrashIcon } from './Icons';

interface Props {
  rules: SetVarRule[];
  onChange: (rules: SetVarRule[] | undefined) => void;
  naming: Naming;
  /** יוצר סימון חדש ברמת השאלון (varMeta), כדי שכל מסך יראה אותו בשמו */
  onDefineVar: (name: string, label: string) => void;
  onDefineVarValue: (name: string, value: string, label: string) => void;
}

const NEW = '__new__';

export function SetVarEditor({ rules, onChange, naming, onDefineVar, onDefineVarValue }: Props) {
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
                // מפתח לפי מה שנערך: הטופס מאותחל מהערכים הקיימים, ולכן הוא
                // חייב להיבנות מחדש כשעוברים לשדה או לסימון אחר
                key={`${creating.field}-${creating.renaming ?? 'new'}`}
                kind={creating.field}
                renaming={Boolean(creating.renaming)}
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
                onCancel={() => setCreating(null)}
                onCreate={(code, label) => {
                  if (creating.field === 'var') {
                    onDefineVar(code, label);
                    patch(i, { ...rule, var: code, value: '' });
                  } else {
                    onDefineVarValue(rule.var, code, label);
                    patch(i, { ...rule, value: code });
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

/** קוד פנוי הבא בסדרה — כדי שהאדמין לא יצטרך להמציא אחד. */
function nextCode(prefix: string, taken: string[]): string {
  for (let n = 1; ; n++) {
    const candidate = `${prefix}${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * התווית קודמת לקוד בכוונה: התווית היא מה שכל הקונסולה תציג, והקוד הוא פרט
 * טכני שנחוץ רק לקובץ הנתונים — הוא מגיע מוכן ורוב האדמינים לא יגעו בו.
 */
function DefineForm({
  kind,
  renaming,
  suggestedCode,
  suggestedLabel,
  onCreate,
  onCancel,
}: {
  kind: 'var' | 'value';
  /** שינוי שם לסימון קיים — הקוד כבר קבוע ולא נערך, רק התווית */
  renaming: boolean;
  suggestedCode: string;
  suggestedLabel: string;
  onCreate: (code: string, label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(suggestedLabel);
  const [code, setCode] = useState(suggestedCode);
  const codeValid = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(code.trim());
  const ready = label.trim().length > 0 && codeValid;

  return (
    <form
      className="define-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCreate(code.trim(), label.trim());
      }}
    >
      <label className="a-field">
        <span className="a-label">
          {kind === 'var' ? 'שם הסימון — כך הוא ייראה בקונסולה' : 'שם הערך — כך הוא ייראה בקונסולה'}
        </span>
        <input
          className="a-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === 'var' ? 'למשל: מסלול המשיב' : 'למשל: מסלול A — יש משכנתה'}
          autoFocus
        />
      </label>
      <label className="a-field">
        <span className="a-label">קוד לקובץ הנתונים</span>
        <input
          className="a-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          dir="ltr"
          aria-invalid={!codeValid}
          disabled={renaming}
          title={renaming ? 'הקוד קבוע — שינוי שלו היה מנתק אותו מהנתונים שכבר נאספו' : undefined}
        />
      </label>
      <div className="define-actions">
        <button className="a-btn primary small" type="submit" disabled={!ready}>
          {renaming ? 'שמירת השם' : 'יצירה'}
        </button>
        <button className="a-btn ghost small" type="button" onClick={onCancel}>
          ביטול
        </button>
      </div>
      {!codeValid && (
        <p className="a-hint error-text">
          הקוד צריך להתחיל באות אנגלית, ולהמשיך באותיות אנגליות, ספרות או קו תחתון
        </p>
      )}
    </form>
  );
}
