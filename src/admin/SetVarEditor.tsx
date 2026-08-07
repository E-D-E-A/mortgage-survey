// עורך כללי onSubmit: הצבת משתני סשן (למשל segment) על בסיס התשובה.
// אזהרת הטוטאליות (ערך ישן אחרי ניווט אחורה) מוצגת בפאנל הוולידציה.

import type { Screen, SetVarRule } from '../engine/types';
import { OptionalCondition } from './ConditionBuilder';
import { PlusIcon, TrashIcon } from './Icons';

interface Props {
  rules: SetVarRule[];
  onChange: (rules: SetVarRule[] | undefined) => void;
  screens: Screen[];
  vars: string[];
}

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

export function SetVarEditor({ rules, onChange, screens, vars }: Props) {
  const emit = (next: SetVarRule[]) => onChange(next.length > 0 ? next : undefined);

  function patch(i: number, rule: SetVarRule) {
    emit(rules.map((r, j) => (j === i ? rule : r)));
  }

  return (
    <div className="a-field">
      <div className="a-field-head">
        <span className="a-label">הצבת משתנים אחרי מענה (onSubmit)</span>
        <button
          className="a-btn ghost small"
          onClick={() => emit([...rules, { var: 'segment', value: '' }])}
        >
          <PlusIcon /> הוספת כלל
        </button>
      </div>
      {rules.map((rule, i) => (
        <div className="rule-card" key={i}>
          <div className="rule-head">
            <span className="rule-index">{i + 1}</span>
            <input
              className="a-input"
              value={rule.var}
              onChange={(e) => patch(i, { ...rule, var: e.target.value })}
              placeholder="שם משתנה"
              list="setvar-known"
              aria-label="שם משתנה"
            />
            <span className="a-label">=</span>
            <input
              className="a-input"
              defaultValue={String(rule.value)}
              key={`v-${i}-${rule.var}`}
              onBlur={(e) => patch(i, { ...rule, value: parseScalar(e.target.value) })}
              placeholder="ערך"
              aria-label="ערך"
            />
            <button
              className="a-icon-btn danger"
              onClick={() => emit(rules.filter((_, j) => j !== i))}
              aria-label="מחיקת כלל"
            >
              <TrashIcon />
            </button>
          </div>
          <OptionalCondition
            label="בתנאי ש…"
            value={rule.if}
            onChange={(cond) => {
              const next: SetVarRule = { var: rule.var, value: rule.value };
              patch(i, cond ? { ...next, if: cond } : next);
            }}
            screens={screens}
            vars={vars}
          />
        </div>
      ))}
      <datalist id="setvar-known">
        {vars.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </div>
  );
}
