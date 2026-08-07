// עורך תנאים רקורסיבי: עלים (שאלה/משתנה + אופרטור + ערך) וקבוצות (וגם/או/לא).
// פולט בדיוק את מבנה ה-Condition של המנוע — מה שנערך כאן רץ ב-evaluate כמו שהוא.

import type { Condition, Op, Screen } from '../engine/types';
import { LIST_OPS, OP_LABELS } from './labels';
import { CloseIcon, PlusIcon } from './Icons';

type Kind = 'q' | 'var' | 'all' | 'any' | 'not';

function kindOf(cond: Condition): Kind {
  if ('all' in cond) return 'all';
  if ('any' in cond) return 'any';
  if ('not' in cond) return 'not';
  return 'q' in cond ? 'q' : 'var';
}

const KIND_LABELS: Record<Kind, string> = {
  q: 'תשובה לשאלה',
  var: 'משתנה',
  all: 'כל התנאים (וגם)',
  any: 'לפחות אחד (או)',
  not: 'לא (שלילה)',
};

export function defaultLeaf(screens: Screen[]): Condition {
  return { q: screens[0]?.id ?? '', op: 'eq', value: '' };
}

/** "42" → 42, "true" → true, אחרת מחרוזת */
function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function valueToText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value === undefined || value === null) return '';
  return String(value);
}

interface BuilderProps {
  value: Condition;
  onChange: (cond: Condition) => void;
  onRemove?: () => void;
  screens: Screen[];
  vars: string[];
}

export function ConditionBuilder({ value, onChange, onRemove, screens, vars }: BuilderProps) {
  const kind = kindOf(value);

  function switchKind(next: Kind) {
    if (next === kind) return;
    switch (next) {
      case 'q':
        onChange(defaultLeaf(screens));
        break;
      case 'var':
        onChange({ var: vars[0] ?? '', op: 'eq', value: '' });
        break;
      case 'all':
        onChange({ all: [value] });
        break;
      case 'any':
        onChange({ any: [value] });
        break;
      case 'not':
        onChange({ not: value });
        break;
    }
  }

  return (
    <div className={`cond-node cond-${kind === 'q' || kind === 'var' ? 'leaf' : 'group'}`}>
      <div className="cond-head">
        <select
          className="a-select cond-kind"
          value={kind}
          onChange={(e) => switchKind(e.target.value as Kind)}
          aria-label="סוג תנאי"
        >
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {onRemove && (
          <button className="a-icon-btn" onClick={onRemove} aria-label="הסרת תנאי" title="הסרת תנאי">
            <CloseIcon />
          </button>
        )}
      </div>

      {(kind === 'q' || kind === 'var') && (
        <LeafEditor value={value} onChange={onChange} screens={screens} vars={vars} />
      )}

      {(kind === 'all' || kind === 'any') && (
        <GroupEditor value={value} onChange={onChange} screens={screens} vars={vars} />
      )}

      {kind === 'not' && 'not' in value && (
        <div className="cond-children">
          <ConditionBuilder
            value={value.not}
            onChange={(c) => onChange({ not: c })}
            screens={screens}
            vars={vars}
          />
        </div>
      )}
    </div>
  );
}

function LeafEditor({ value, onChange, screens, vars }: BuilderProps) {
  const isQ = 'q' in value;
  const leaf = value as { q?: string; var?: string; op: Op; value?: unknown };
  const questionScreens = screens.filter((s) => s.type !== 'info' && s.type !== 'end');
  const needsValue = leaf.op !== 'answered';
  const isList = LIST_OPS.includes(leaf.op);

  // אפשרויות ערך מוכרות כשהשאלה היא בחירה — datalist להשלמה, לא כפייה
  const refScreen = isQ ? screens.find((s) => s.id === leaf.q) : undefined;
  const knownValues =
    refScreen && (refScreen.type === 'single' || refScreen.type === 'multi')
      ? refScreen.options.map((o) => o.id)
      : refScreen?.type === 'consent'
        ? ['agreed', 'declined']
        : [];
  const listId = `cond-vals-${isQ ? leaf.q : leaf.var}`;

  function patch(p: Partial<{ q: string; var: string; op: Op; value: unknown }>) {
    const base = isQ ? { q: p.q ?? leaf.q!, op: p.op ?? leaf.op } : { var: p.var ?? leaf.var!, op: p.op ?? leaf.op };
    const nextOp = p.op ?? leaf.op;
    const withValue =
      nextOp === 'answered' ? base : { ...base, value: 'value' in p ? p.value : leaf.value };
    onChange(withValue as Condition);
  }

  return (
    <div className="cond-leaf-row">
      {isQ ? (
        <select
          className="a-select"
          value={leaf.q}
          onChange={(e) => patch({ q: e.target.value })}
          aria-label="שאלה"
        >
          {!questionScreens.some((s) => s.id === leaf.q) && <option value={leaf.q}>{leaf.q}</option>}
          {questionScreens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            className="a-input cond-var"
            value={leaf.var}
            onChange={(e) => patch({ var: e.target.value })}
            placeholder="שם משתנה"
            list="cond-known-vars"
            aria-label="משתנה"
          />
          <datalist id="cond-known-vars">
            {vars.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      )}

      <select
        className="a-select"
        value={leaf.op}
        onChange={(e) => patch({ op: e.target.value as Op })}
        aria-label="אופרטור"
      >
        {(Object.keys(OP_LABELS) as Op[]).map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      {needsValue && (
        <>
          <input
            className="a-input cond-value"
            defaultValue={valueToText(leaf.value)}
            key={`${isQ ? leaf.q : leaf.var}-${leaf.op}`}
            onBlur={(e) => {
              const raw = e.target.value;
              patch({
                value: isList
                  ? raw.split(',').map((s) => parseScalar(s)).filter((v) => v !== '')
                  : parseScalar(raw),
              });
            }}
            placeholder={isList ? 'ערכים מופרדים בפסיק' : 'ערך'}
            list={knownValues.length > 0 ? listId : undefined}
            aria-label="ערך"
          />
          {knownValues.length > 0 && (
            <datalist id={listId}>
              {knownValues.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}

function GroupEditor({ value, onChange, screens, vars }: BuilderProps) {
  const isAll = 'all' in value;
  const children = isAll ? (value as { all: Condition[] }).all : (value as { any: Condition[] }).any;
  const wrap = (kids: Condition[]): Condition => (isAll ? { all: kids } : { any: kids });

  return (
    <div className="cond-children">
      {children.map((child, i) => (
        <ConditionBuilder
          key={i}
          value={child}
          onChange={(c) => onChange(wrap(children.map((k, j) => (j === i ? c : k))))}
          onRemove={
            children.length > 1 ? () => onChange(wrap(children.filter((_, j) => j !== i))) : undefined
          }
          screens={screens}
          vars={vars}
        />
      ))}
      <button
        className="a-btn ghost small"
        onClick={() => onChange(wrap([...children, defaultLeaf(screens)]))}
      >
        <PlusIcon /> הוספת תנאי
      </button>
    </div>
  );
}

/** שדה תנאי אופציונלי: "תמיד" ⇄ עורך תנאי */
export function OptionalCondition({
  label,
  value,
  onChange,
  screens,
  vars,
}: {
  label: string;
  value: Condition | undefined;
  onChange: (cond: Condition | undefined) => void;
  screens: Screen[];
  vars: string[];
}) {
  return (
    <div className="a-field">
      <div className="a-field-head">
        <span className="a-label">{label}</span>
        {value ? (
          <button className="a-btn ghost small" onClick={() => onChange(undefined)}>
            הסרת התנאי (תמיד)
          </button>
        ) : (
          <button className="a-btn ghost small" onClick={() => onChange(defaultLeaf(screens))}>
            <PlusIcon /> הוספת תנאי
          </button>
        )}
      </div>
      {value && (
        <ConditionBuilder value={value} onChange={onChange} screens={screens} vars={vars} />
      )}
    </div>
  );
}
