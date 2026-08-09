import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { numberFieldError, numberFieldValue, orderOptions, textLimit } from '../engine/input-rules';
import { shuffle } from '../engine/random';
import type {
  AnswerValue,
  ConsentScreen,
  InfoScreen,
  MatrixAnswer,
  MatrixScreen,
  MultiChoiceScreen,
  NumberScreen,
  Option,
  SingleChoiceScreen,
  TextScreen,
} from '../engine/types';

export type SubmitFn = (value: AnswerValue | undefined, extra?: Record<string, unknown>) => void;

/**
 * התשובה שכבר ניתנה למסך הזה, אם ניתנה. חזרה אחורה חייבת להציג אותה —
 * מסך ריק אחרי חזרה משקר למשיב ומכריח אותו לענות מחדש.
 *
 * הזריעה בטוחה למרות ש-useState קורא את הערך ההתחלתי פעם אחת בלבד: App.tsx
 * מרנדר את המסך עם key={screen.id}, כך שכל מעבר מסך מרכיב את הרכיב מחדש.
 */
export interface ViewProps<S> {
  screen: S;
  submit: SubmitFn;
  initial?: AnswerValue;
}

/** כותרת המסך — משמשת גם כשם הנגיש של קבוצת האפשרויות ושל שדות הקלט. */
function promptId(screenId: string): string {
  return `prompt-${screenId}`;
}

/**
 * כותרת המסך. מעבר בין מסכים אינו טעינת דף, ולכן המיקוד נשאר במקום שבו היה
 * הכפתור שנעלם — כלומר על ה-body. App.tsx מעביר את המיקוד לכותרת בכל החלפת
 * מסך, וזה מה שמאפשר לה לקבל אותו (tabIndex={-1} = ניתן למיקוד בקוד, לא ב-Tab).
 */
export const SCREEN_TITLE_CLASS = 'screen-title';

export function ScreenTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h1 id={id} className={SCREEN_TITLE_CLASS} tabIndex={-1}>
      {children}
    </h1>
  );
}

/**
 * ניווט מקלדת בקבוצת בחירה יחידה. כפתורים עם role="radio" נראים לקורא מסך
 * כקבוצת רדיו, ומשתמש מקלדת מצפה בהתאם לחיצים — ולא ל-Tab על כל אפשרות.
 *
 * הכיוון הוויזואלי הוא RTL: "הבא" יושב משמאל ברשימה אופקית (סולם המטריצה)
 * ומתחת ברשימה אנכית, ולכן ArrowLeft ו-ArrowDown מקדמים, והשניים האחרים מחזירים.
 */
function radioGroupKeys<T>(
  values: readonly T[],
  current: T | undefined,
  select: (v: T) => void,
): (e: React.KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = current === undefined ? -1 : values.indexOf(current);
    // בלי בחירה קודמת החץ הראשון בוחר את הקצה שאליו הוא מצביע
    const next = at < 0 ? (step === 1 ? 0 : values.length - 1) : (at + step + values.length) % values.length;
    select(values[next]);
    // המיקוד נודד עם הבחירה — זו ההתנהגות של קבוצת רדיו מובנית
    const group = e.currentTarget;
    requestAnimationFrame(() => {
      const el = group.querySelectorAll<HTMLElement>('[role="radio"]')[next];
      el?.focus();
    });
  };
}

/** רק האפשרות הנבחרת (או הראשונה, כשאין בחירה) יושבת במסלול ה-Tab. */
function rovingTabIndex(selected: boolean, isFirst: boolean, anySelected: boolean): 0 | -1 {
  return selected || (!anySelected && isFirst) ? 0 : -1;
}

/**
 * שורת הפעולה של המסך. במובייל היא נדבקת לתחתית המסך (styles.css) כדי
 * שכפתור ההמשך יהיה תמיד באזור האגודל — ברשימת אפשרויות ארוכה הוא היה
 * דורש גלילה עד הסוף לפני כל מעבר.
 */
function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

export function InfoView({ screen, submit }: ViewProps<InfoScreen>) {
  return (
    <div className="screen">
      <ScreenTitle>{screen.title}</ScreenTitle>
      <Paragraphs text={screen.body} />
      <Actions>
        <button className="btn primary" onClick={() => submit(undefined)}>
          {screen.cta ?? 'המשך'}
        </button>
      </Actions>
    </div>
  );
}

export function ConsentView({ screen, submit }: ViewProps<ConsentScreen>) {
  const [hp, setHp] = useState('');
  return (
    <div className="screen">
      <ScreenTitle>{screen.title}</ScreenTitle>
      <Paragraphs text={screen.body} />
      {/* honeypot — משתמש אמיתי לא רואה ולא ממלא את השדה */}
      <input
        className="hp"
        type="text"
        name="website"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <Actions>
        <button className="btn primary" onClick={() => submit('agreed', { hp: hp !== '' })}>
          {screen.agreeLabel}
        </button>
        <button className="btn secondary" onClick={() => submit('declined', { hp: hp !== '' })}>
          {screen.declineLabel}
        </button>
      </Actions>
    </div>
  );
}

function OptionButton({
  option,
  role,
  selected,
  disabled,
  tabIndex,
  onClick,
}: {
  option: Option;
  /** radio לבחירה יחידה, checkbox לרב-ברירה — קורא מסך מקריא "2 מתוך 4" ולא "לחצן" */
  role: 'radio' | 'checkbox';
  selected: boolean;
  disabled?: boolean;
  tabIndex?: 0 | -1;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      className={`option${selected ? ' selected' : ''}`}
      aria-checked={selected}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
    >
      {option.label}
    </button>
  );
}

export function SingleChoiceView({ screen, submit, initial }: ViewProps<SingleChoiceScreen>) {
  const options = useMemo(
    () => orderOptions(screen.options, screen.shuffleOptions),
    [screen],
  );
  const [selected, setSelected] = useState<string | null>(
    typeof initial === 'string' ? initial : null,
  );
  const ids = useMemo(() => options.map((o) => o.id), [options]);
  return (
    <div className="screen">
      <ScreenTitle id={promptId(screen.id)}>{screen.prompt}</ScreenTitle>
      {screen.help && <p className="help">{screen.help}</p>}
      <div
        className="options"
        role="radiogroup"
        aria-labelledby={promptId(screen.id)}
        onKeyDown={radioGroupKeys(ids, selected ?? undefined, setSelected)}
      >
        {options.map((o, i) => (
          <OptionButton
            key={o.id}
            option={o}
            role="radio"
            selected={selected === o.id}
            tabIndex={rovingTabIndex(selected === o.id, i === 0, selected !== null)}
            onClick={() => setSelected(o.id)}
          />
        ))}
      </div>
      <Actions>
        <button
          className="btn primary"
          disabled={selected === null}
          onClick={() => submit(selected, { order: options.map((o) => o.id) })}
        >
          המשך
        </button>
      </Actions>
    </div>
  );
}

export function MultiChoiceView({ screen, submit, initial }: ViewProps<MultiChoiceScreen>) {
  const options = useMemo(
    () => orderOptions(screen.options, screen.shuffleOptions),
    [screen],
  );
  const [selected, setSelected] = useState<string[]>(Array.isArray(initial) ? initial : []);

  const max = screen.maxSelections;
  // מכסה מלאה: האפשרויות שלא נבחרו מנוטרלות במקום להתעלם בשקט מהלחיצה.
  // אפשרות בלעדית תמיד פעילה — היא מנקה את הבחירות ולכן לעולם לא חורגת.
  const atCap = max !== undefined && max > 0 && selected.length >= max;

  function toggle(o: Option) {
    setSelected((prev) => {
      if (prev.includes(o.id)) return prev.filter((id) => id !== o.id);
      if (o.exclusive) return [o.id];
      const withoutExclusive = prev.filter((id) => !options.find((x) => x.id === id)?.exclusive);
      if (max !== undefined && max > 0 && withoutExclusive.length >= max) return withoutExclusive;
      return [...withoutExclusive, o.id];
    });
  }

  return (
    <div className="screen">
      <ScreenTitle id={promptId(screen.id)}>{screen.prompt}</ScreenTitle>
      {screen.help && <p className="help">{screen.help}</p>}
      {max !== undefined && max > 0 && (
        <p className={`help${atCap ? ' at-cap' : ''}`} aria-live="polite">
          {atCap
            ? `נבחרו ${max} מתוך ${max} — כדי לבחור אחרת, בטלו קודם אחת מהבחירות`
            : `עד ${max} בחירות`}
        </p>
      )}
      <div className="options" role="group" aria-labelledby={promptId(screen.id)}>
        {options.map((o) => (
          <OptionButton
            key={o.id}
            option={o}
            role="checkbox"
            selected={selected.includes(o.id)}
            disabled={atCap && !selected.includes(o.id) && !o.exclusive}
            onClick={() => toggle(o)}
          />
        ))}
      </div>
      <Actions>
        <button
          className="btn primary"
          disabled={selected.length === 0}
          onClick={() => submit(selected, { order: options.map((o) => o.id) })}
        >
          המשך
        </button>
      </Actions>
    </div>
  );
}

export function MatrixView({ screen, submit, initial }: ViewProps<MatrixScreen>) {
  // עמודת ה-na אינה חלק מ-items ולכן נשארת מעוגנת אחרונה גם בערבוב
  const items = useMemo(
    () => (screen.shuffleItems ? shuffle(screen.items) : screen.items),
    [screen],
  );
  const [values, setValues] = useState<MatrixAnswer>(
    initial && typeof initial === 'object' && !Array.isArray(initial) ? initial : {},
  );
  const scale: number[] = [];
  for (let v = screen.scaleMin; v <= screen.scaleMax; v++) scale.push(v);
  const complete = items.every((it) => values[it.id] !== undefined);
  // עמודת "לא רלוונטי" היא ערך נוסף בקבוצה, ולכן היא חלק ממסלול החיצים
  const cells: (number | 'na')[] = screen.naLabel ? [...scale, 'na'] : scale;

  /** קצות הסולם נושאים את המשמעות — "1" לבדו לא אומר לקורא מסך דבר. */
  const cellLabel = (v: number | 'na'): string =>
    v === 'na'
      ? (screen.naLabel as string)
      : v === screen.scaleMin
        ? `${v} — ${screen.minLabel}`
        : v === screen.scaleMax
          ? `${v} — ${screen.maxLabel}`
          : `${v}`;

  return (
    <div className="screen">
      <ScreenTitle>{screen.prompt}</ScreenTitle>
      <p className="help">
        {screen.scaleMin} = {screen.minLabel} · {screen.scaleMax} = {screen.maxLabel}
      </p>
      {items.map((it) => (
        <div key={it.id} className="matrix-item">
          <div className="matrix-label" id={`${screen.id}-${it.id}`}>
            {it.label}
          </div>
          <div
            className="scale"
            role="radiogroup"
            aria-labelledby={`${screen.id}-${it.id}`}
            onKeyDown={radioGroupKeys(cells, values[it.id], (v) =>
              setValues((prev) => ({ ...prev, [it.id]: v })),
            )}
          >
            {cells.map((v, i) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={values[it.id] === v}
                aria-label={cellLabel(v)}
                tabIndex={rovingTabIndex(values[it.id] === v, i === 0, values[it.id] !== undefined)}
                className={`scale-btn${v === 'na' ? ' na' : ''}${values[it.id] === v ? ' selected' : ''}`}
                onClick={() => setValues((prev) => ({ ...prev, [it.id]: v }))}
              >
                {v === 'na' ? screen.naLabel : v}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Actions>
        <button
          className="btn primary"
          disabled={!complete}
          onClick={() => submit(values, { order: items.map((i) => i.id) })}
        >
          המשך
        </button>
      </Actions>
    </div>
  );
}

export function NumberView({ screen, submit, initial }: ViewProps<NumberScreen>) {
  const [raw, setRaw] = useState(typeof initial === 'number' ? String(initial) : '');
  // ההודעה מוצגת מיד ולא ב-blur: כפתור "המשך" חסום אינו לוחיץ ולכן אינו מוציא
  // את המיקוד מהשדה — משיב שהקליד 15 היה נשאר בלי שום הסבר עד שיילחץ במקום אחר.
  const error = numberFieldError(screen, raw);
  const value = numberFieldValue(screen, raw);
  const errorId = `${screen.id}-error`;

  // ההסבר והיחידה הם חלק מהשאלה, ולכן הם נקראים יחד עם השדה ולא נופלים בין
  // הכיסאות: בלי זה קורא מסך מכריז על "עריכת טקסט" בלי שום שם
  const helpId = `${screen.id}-help`;
  const unitId = `${screen.id}-unit`;
  const describedBy = [screen.help && helpId, screen.unit && unitId, error && errorId]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="screen">
      <ScreenTitle id={promptId(screen.id)}>{screen.prompt}</ScreenTitle>
      {screen.help && (
        <p className="help" id={helpId}>
          {screen.help}
        </p>
      )}
      <div className="number-row">
        <input
          type="number"
          inputMode={screen.integer ? 'numeric' : 'decimal'}
          value={raw}
          min={screen.min}
          max={screen.max}
          step={screen.integer ? 1 : undefined}
          aria-labelledby={promptId(screen.id)}
          aria-invalid={error !== null}
          aria-describedby={describedBy || undefined}
          onChange={(e) => setRaw(e.target.value)}
          className={`input${error ? ' invalid' : ''}`}
        />
        {screen.unit && (
          <span className="unit" id={unitId}>
            {screen.unit}
          </span>
        )}
      </div>
      {error && (
        <p className="field-error" id={errorId} aria-live="polite">
          {error}
        </p>
      )}
      <Actions>
        <button className="btn primary" disabled={value === null} onClick={() => submit(value)}>
          המשך
        </button>
      </Actions>
    </div>
  );
}

export function TextView({ screen, submit, initial }: ViewProps<TextScreen>) {
  const [text, setText] = useState(typeof initial === 'string' ? initial : '');
  const limit = textLimit(screen);
  const empty = text.trim() === '';

  const helpId = `${screen.id}-help`;
  const optionalId = `${screen.id}-optional`;
  const describedBy = [screen.help && helpId, screen.optional && optionalId]
    .filter(Boolean)
    .join(' ');
  const fieldProps = {
    className: 'input',
    value: text,
    placeholder: screen.placeholder,
    maxLength: limit,
    'aria-labelledby': promptId(screen.id),
    'aria-describedby': describedBy || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setText(e.target.value),
  };

  return (
    <div className="screen">
      <ScreenTitle id={promptId(screen.id)}>{screen.prompt}</ScreenTitle>
      {screen.help && (
        <p className="help" id={helpId}>
          {screen.help}
        </p>
      )}
      {screen.optional && (
        <p className="help" id={optionalId}>
          אפשר להשאיר ריק ולהמשיך.
        </p>
      )}
      {screen.multiline ? (
        <textarea rows={5} {...fieldProps} />
      ) : (
        <input type="text" {...fieldProps} />
      )}
      {text.length > 0 && (
        <p className={`char-count${text.length >= limit ? ' at-limit' : ''}`} aria-live="polite">
          {text.length} / {limit}
        </p>
      )}
      <Actions>
        <button
          className="btn primary"
          disabled={empty && !screen.optional}
          onClick={() => submit(empty ? null : text.trim())}
        >
          {screen.optional && empty ? 'דילוג' : 'המשך'}
        </button>
      </Actions>
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
