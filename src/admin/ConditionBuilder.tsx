// A recursive condition editor: leaves (question/variable + operator + value) and
// groups (and/or/not). It emits exactly the engine's Condition shape — what is
// edited here runs through evaluate as it stands.
//
// The admin picks from the option wording, not from ids: when the question is a
// choice, the value field is a list of real answers. Free text remains only where
// there are no known values (a number, text, a variable with no varMeta) — there
// is nothing to offer there.

import type { Condition, Op, Screen } from '../engine/types';
import type { Naming } from './display';
import { conditionSentence, screenRef, varLabel } from './display';
import { LIST_OPS, OP_LABELS_ANSWER, OP_LABELS_MARK } from './labels';
import { CloseIcon, PlusIcon } from './Icons';

type Kind = 'q' | 'var' | 'all' | 'any' | 'not';

function kindOf(cond: Condition): Kind {
  if ('all' in cond) return 'all';
  if ('any' in cond) return 'any';
  if ('not' in cond) return 'not';
  return 'q' in cond ? 'q' : 'var';
}

// "Mark" and not "variable" — the same word the other screens use for the same
// concept. The groups are written as whole sentences ("all the conditions hold")
// rather than as the name of the logical operation: "and / or / not" force the
// reader to translate, and that translation is exactly what breaks.
const KIND_LABELS: Record<Kind, string> = {
  q: 'לפי תשובה לשאלה',
  var: 'לפי סימון על המשיב',
  all: 'כל התנאים שבפנים מתקיימים',
  any: 'לפחות תנאי אחד שבפנים מתקיים',
  not: 'ההפך — התנאי שבפנים לא מתקיים',
};

/** The screens that can be conditioned on — an info screen and an end screen have no answer. */
function questionScreens(naming: Naming): Screen[] {
  return naming.screens.filter((s) => s.type !== 'info' && s.type !== 'end');
}

export function defaultLeaf(naming: Naming): Condition {
  return { q: questionScreens(naming)[0]?.id ?? naming.screens[0]?.id ?? '', op: 'eq', value: '' };
}

/** "42" → 42, "true" → true, otherwise a string */
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

/**
 * The values that can be offered for a leaf — [id, label]. An empty list = there
 * is nothing to offer, and we fall back to a free-text field (a number, open
 * text, a variable with no varMeta).
 */
function knownValues(naming: Naming, leaf: Leaf): [string, string][] {
  if (leaf.q !== undefined) {
    const screen = naming.screens.find((s) => s.id === leaf.q);
    if (screen?.type === 'single' || screen?.type === 'multi') {
      return screen.options.map((o) => [o.id, o.label.trim() || o.id]);
    }
    if (screen?.type === 'consent') {
      return [
        ['agreed', 'הסכים/ה להשתתף'],
        ['declined', 'סירב/ה להשתתף'],
      ];
    }
    return [];
  }
  const values = naming.varMeta[leaf.var ?? '']?.values;
  return values ? Object.entries(values) : [];
}

type Leaf = { q?: string; var?: string; op: Op; value?: unknown };

interface BuilderProps {
  value: Condition;
  onChange: (cond: Condition) => void;
  onRemove?: () => void;
  naming: Naming;
}

export function ConditionBuilder({ value, onChange, onRemove, naming }: BuilderProps) {
  const kind = kindOf(value);

  function switchKind(next: Kind) {
    if (next === kind) return;
    switch (next) {
      case 'q':
        onChange(defaultLeaf(naming));
        break;
      case 'var':
        onChange({ var: naming.vars[0] ?? '', op: 'eq', value: '' });
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
          aria-label="על מה התנאי מסתכל"
        >
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {onRemove && (
          <button className="a-icon-btn" onClick={onRemove} aria-label="הסרת התנאי הזה" title="הסרת התנאי הזה">
            <CloseIcon />
          </button>
        )}
      </div>

      {(kind === 'q' || kind === 'var') && (
        <LeafEditor value={value} onChange={onChange} naming={naming} />
      )}

      {(kind === 'all' || kind === 'any') && (
        <GroupEditor value={value} onChange={onChange} naming={naming} />
      )}

      {kind === 'not' && 'not' in value && (
        <div className="cond-children">
          <ConditionBuilder value={value.not} onChange={(c) => onChange({ not: c })} naming={naming} />
        </div>
      )}
    </div>
  );
}

function LeafEditor({ value, onChange, naming }: BuilderProps) {
  const leaf = value as Leaf;
  const isQ = leaf.q !== undefined;
  const needsValue = leaf.op !== 'answered';
  const isList = LIST_OPS.includes(leaf.op);
  const options = knownValues(naming, leaf);
  // The dropdown is phrased as a continuation of the subject, so it depends on
  // it: "the answer is…" versus "the respondent's track is…"
  const opLabels = isQ ? OP_LABELS_ANSWER : OP_LABELS_MARK;

  function patch(p: Partial<Leaf>) {
    const base = isQ
      ? { q: p.q ?? leaf.q!, op: p.op ?? leaf.op }
      : { var: p.var ?? leaf.var!, op: p.op ?? leaf.op };
    const nextOp = p.op ?? leaf.op;
    const withValue =
      nextOp === 'answered' ? base : { ...base, value: 'value' in p ? p.value : leaf.value };
    onChange(withValue as Condition);
  }

  /** Switching between a single-value operator and a list operator has to carry
      the value across, otherwise "one of" receives a string and evaluate finds no
      match, with nothing in the air to say why. */
  function changeOp(op: Op) {
    if (op === 'answered') return patch({ op });
    const nowList = LIST_OPS.includes(op);
    if (nowList === isList) return patch({ op });
    const current = leaf.value;
    const next = nowList
      ? current === undefined || current === '' ? [] : Array.isArray(current) ? current : [current]
      : Array.isArray(current) ? (current[0] ?? '') : current;
    patch({ op, value: next });
  }

  return (
    <div className="cond-leaf-row">
      {isQ ? (
        <select
          className="a-select cond-subject"
          value={leaf.q}
          onChange={(e) => patch({ q: e.target.value, value: '' })}
          aria-label="השאלה שהתנאי בודק"
          title={leaf.q}
        >
          {!questionScreens(naming).some((s) => s.id === leaf.q) && (
            <option value={leaf.q}>{screenRef(naming, leaf.q!)}</option>
          )}
          {questionScreens(naming).map((s) => (
            <option key={s.id} value={s.id}>
              {screenRef(naming, s.id)}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="a-select cond-subject"
          value={leaf.var}
          onChange={(e) => patch({ var: e.target.value, value: '' })}
          aria-label="הסימון שהתנאי בודק"
          title={leaf.var}
        >
          {!naming.vars.includes(leaf.var ?? '') && (
            <option value={leaf.var}>{varLabel(naming, leaf.var ?? '')}</option>
          )}
          {naming.vars.map((v) => (
            <option key={v} value={v}>
              {varLabel(naming, v)}
            </option>
          ))}
        </select>
      )}

      <select
        className="a-select"
        value={leaf.op}
        onChange={(e) => changeOp(e.target.value as Op)}
        aria-label={isQ ? 'מה בודקים בתשובה' : 'מה בודקים בסימון'}
      >
        {(Object.keys(opLabels) as Op[]).map((op) => (
          <option key={op} value={op}>
            {opLabels[op]}
          </option>
        ))}
      </select>

      {needsValue &&
        (options.length > 0 ? (
          <ValuePicker
            options={options}
            multiple={isList}
            value={leaf.value}
            onChange={(v) => patch({ value: v })}
          />
        ) : (
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
            placeholder={isList ? 'כמה ערכים, מופרדים בפסיק' : 'הערך להשוואה'}
            aria-label="הערך להשוואה"
          />
        ))}
    </div>
  );
}

/**
 * Picking a value from the answer wording. A single-value operator = a dropdown;
 * a list operator = checkboxes, because "one of" with a comma-separated text
 * field was the place where ids got printed at the admin whether they liked it
 * or not.
 */
function ValuePicker({
  options,
  multiple,
  value,
  onChange,
}: {
  options: [string, string][];
  multiple: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (!multiple) {
    const current = value === undefined || value === null ? '' : String(value);
    return (
      <select
        className="a-select cond-value"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        aria-label="התשובה להשוואה"
      >
        {!options.some(([id]) => id === current) && (
          <option value={current}>{current || '— בחרו תשובה —'}</option>
        )}
        {options.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    );
  }

  const selected = new Set((Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String));
  return (
    <div className="cond-value-list">
      {options.map(([id, label]) => (
        <label className="a-check compact" key={id}>
          <input
            type="checkbox"
            checked={selected.has(id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(id);
              else next.delete(id);
              // The option order and not the click order — the list stays stable between edits
              onChange(options.map(([oid]) => oid).filter((oid) => next.has(oid)));
            }}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function GroupEditor({ value, onChange, naming }: BuilderProps) {
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
          naming={naming}
        />
      ))}
      <button
        className="a-btn ghost small"
        onClick={() => onChange(wrap([...children, defaultLeaf(naming)]))}
      >
        <PlusIcon /> הוספת תנאי
      </button>
    </div>
  );
}

/**
 * An optional condition field: "always" ⇄ a condition editor. The sentence above
 * the editor is what most admins actually read — the tree below it is there for
 * editing, not for understanding.
 */
export function OptionalCondition({
  label,
  value,
  onChange,
  naming,
}: {
  label: string;
  value: Condition | undefined;
  onChange: (cond: Condition | undefined) => void;
  naming: Naming;
}) {
  return (
    <div className="a-field">
      <div className="a-field-head">
        <span className="a-label">{label}</span>
        {value ? (
          <button className="a-btn ghost small" onClick={() => onChange(undefined)}>
            הסרת התנאי — יקרה תמיד
          </button>
        ) : (
          <button className="a-btn ghost small" onClick={() => onChange(defaultLeaf(naming))}>
            <PlusIcon /> הוספת תנאי
          </button>
        )}
      </div>
      {value && (
        <>
          <p className="cond-sentence">{conditionSentence(naming, value)}</p>
          <ConditionBuilder value={value} onChange={onChange} naming={naming} />
        </>
      )}
    </div>
  );
}
