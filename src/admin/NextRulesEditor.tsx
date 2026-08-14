// The routing rules (next) editor: an ordered list of "if condition → go to
// screen". The first rule whose condition holds wins; a rule with no condition is
// a default that always catches.

import type { GotoRule } from '../engine/types';
import type { Naming } from './display';
import { screenRef } from './display';
import { OptionalCondition } from './ConditionBuilder';
import { DownIcon, TrashIcon, UpIcon } from './Icons';

interface Props {
  rules: GotoRule[];
  onChange: (rules: GotoRule[] | undefined) => void;
  naming: Naming;
}

export function NextRulesEditor({ rules, onChange, naming }: Props) {
  const emit = (next: GotoRule[]) => onChange(next.length > 0 ? next : undefined);
  const screens = naming.screens;

  function patch(i: number, rule: GotoRule) {
    emit(rules.map((r, j) => (j === i ? rule : r)));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    emit(next);
  }

  return (
    <div className="a-field">
      {rules.length === 0 && (
        <p className="ed-empty">
          אין כללים, ולכן ממשיכים לפי הסדר — למסך הבא ברשימה שמתאים למשיב.
        </p>
      )}
      {rules.length > 1 && (
        <p className="a-hint">הכללים נבדקים מלמעלה למטה, והראשון שמתאים הוא זה שקורה.</p>
      )}
      {rules.map((rule, i) => (
        <div className="rule-card" key={i}>
          <div className="rule-head">
            <span className="rule-index">{i + 1}</span>
            <span className="a-label">קפיצה אל</span>
            <select
              className="a-select"
              value={rule.goto}
              onChange={(e) => patch(i, { ...rule, goto: e.target.value })}
              aria-label="המסך שקופצים אליו"
              title={rule.goto}
            >
              {!screens.some((s) => s.id === rule.goto) && (
                <option value={rule.goto}>{rule.goto || '—'}</option>
              )}
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {screenRef(naming, s.id)}
                </option>
              ))}
            </select>
            <span className="rule-actions">
              <button className="a-icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="הקדמת הכלל — ייבדק מוקדם יותר">
                <UpIcon />
              </button>
              <button
                className="a-icon-btn"
                onClick={() => move(i, 1)}
                disabled={i === rules.length - 1}
                aria-label="איחור הכלל — ייבדק מאוחר יותר"
              >
                <DownIcon />
              </button>
              <button
                className="a-icon-btn danger"
                onClick={() => emit(rules.filter((_, j) => j !== i))}
                aria-label="מחיקת הכלל"
              >
                <TrashIcon />
              </button>
            </span>
          </div>
          <OptionalCondition
            label="קופצים רק אם…"
            value={rule.if}
            onChange={(cond) => {
              const next: GotoRule = cond ? { if: cond, goto: rule.goto } : { goto: rule.goto };
              patch(i, next);
            }}
            naming={naming}
          />
        </div>
      ))}
    </div>
  );
}
