// עורך תנאים רקורסיבי: עלים (שאלה/משתנה + אופרטור + ערך) וקבוצות (וגם/או/לא).
// פולט בדיוק את מבנה ה-Condition של המנוע — מה שנערך כאן רץ ב-evaluate כמו שהוא.
//
// האדמין בוחר מתוך נוסח האפשרויות, לא מתוך מזהים: כשהשאלה היא בחירה, שדה הערך
// הוא רשימה של תשובות אמיתיות. טקסט חופשי נשאר רק היכן שאין ערכים ידועים
// (מספר, טקסט, משתנה בלי varMeta) — שם אין מה להציע.

import type { Condition, Op, Screen } from '../engine/types';
import type { Naming } from './display';
import { conditionSentence, screenRef, varLabel } from './display';
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

/** מסכים שאפשר להתנות עליהם — למסך מידע ולמסך סיום אין תשובה. */
function questionScreens(naming: Naming): Screen[] {
  return naming.screens.filter((s) => s.type !== 'info' && s.type !== 'end');
}

export function defaultLeaf(naming: Naming): Condition {
  return { q: questionScreens(naming)[0]?.id ?? naming.screens[0]?.id ?? '', op: 'eq', value: '' };
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

/**
 * הערכים שאפשר להציע לעלה — ‏[מזהה, תווית]. רשימה ריקה = אין מה להציע, ואז
 * נופלים לשדה טקסט חופשי (מספר, טקסט פתוח, משתנה בלי varMeta).
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

  function patch(p: Partial<Leaf>) {
    const base = isQ
      ? { q: p.q ?? leaf.q!, op: p.op ?? leaf.op }
      : { var: p.var ?? leaf.var!, op: p.op ?? leaf.op };
    const nextOp = p.op ?? leaf.op;
    const withValue =
      nextOp === 'answered' ? base : { ...base, value: 'value' in p ? p.value : leaf.value };
    onChange(withValue as Condition);
  }

  /** מעבר בין אופרטור יחיד לאופרטור רשימה חייב לגרור את הערך, אחרת "אחד מ־"
      מקבל מחרוזת ו-evaluate לא מוצא התאמה בלי שום סימן באוויר. */
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
          aria-label="שאלה"
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
          aria-label="משתנה"
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
        aria-label="אופרטור"
      >
        {(Object.keys(OP_LABELS) as Op[]).map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
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
            placeholder={isList ? 'ערכים מופרדים בפסיק' : 'ערך'}
            aria-label="ערך"
          />
        ))}
    </div>
  );
}

/**
 * בחירת ערך מתוך נוסח התשובות. אופרטור יחיד = רשימה נפתחת; אופרטור רשימה =
 * תיבות סימון, כי "אחד מתוך" עם שדה טקסט מופרד בפסיקים היה המקום שבו מזהים
 * הודפסו לאדמין בעל כורחו.
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
        aria-label="ערך"
      >
        {!options.some(([id]) => id === current) && (
          <option value={current}>{current || '— בחירת תשובה —'}</option>
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
              // סדר האפשרויות ולא סדר הלחיצות — הרשימה יציבה בין עריכות
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
 * שדה תנאי אופציונלי: "תמיד" ⇄ עורך תנאי. המשפט מעל העורך הוא מה שרוב האדמינים
 * באמת קוראים — מבנה העץ שמתחתיו נועד לעריכה, לא להבנה.
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
            הסרת התנאי (תמיד)
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
