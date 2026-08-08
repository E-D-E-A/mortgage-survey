// עורך כללי הניתוב (next): רשימה סדורה של "אם תנאי → מעבר למסך".
// הכלל הראשון שתנאו מתקיים מנצח; כלל בלי תנאי הוא ברירת מחדל שתמיד נתפסת.

import type { GotoRule } from '../engine/types';
import type { Naming } from './display';
import { screenRef } from './display';
import { OptionalCondition } from './ConditionBuilder';
import { DownIcon, PlusIcon, TrashIcon, UpIcon } from './Icons';

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
      <div className="a-field-head">
        <span className="a-label">קפיצה למסך אחר (הכלל הראשון שמתקיים מנצח)</span>
        <button
          className="a-btn ghost small"
          onClick={() => emit([...rules, { goto: screens[0]?.id ?? '' }])}
        >
          <PlusIcon /> הוספת כלל
        </button>
      </div>
      {rules.length === 0 && (
        <p className="a-hint">בלי כללים — ממשיכים למסך הבא ברשימה שעובר את תנאי התצוגה שלו.</p>
      )}
      {rules.map((rule, i) => (
        <div className="rule-card" key={i}>
          <div className="rule-head">
            <span className="rule-index">{i + 1}</span>
            <span className="a-label">מעבר אל</span>
            <select
              className="a-select"
              value={rule.goto}
              onChange={(e) => patch(i, { ...rule, goto: e.target.value })}
              aria-label="מסך יעד"
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
              <button className="a-icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="העלאת כלל">
                <UpIcon />
              </button>
              <button
                className="a-icon-btn"
                onClick={() => move(i, 1)}
                disabled={i === rules.length - 1}
                aria-label="הורדת כלל"
              >
                <DownIcon />
              </button>
              <button
                className="a-icon-btn danger"
                onClick={() => emit(rules.filter((_, j) => j !== i))}
                aria-label="מחיקת כלל"
              >
                <TrashIcon />
              </button>
            </span>
          </div>
          <OptionalCondition
            label="בתנאי ש…"
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
