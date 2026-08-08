import { useMemo, useState } from 'react';
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

/** כותרת המסך — משמשת גם כשם הנגיש של קבוצת האפשרויות. */
function promptId(screenId: string): string {
  return `prompt-${screenId}`;
}

export function InfoView({ screen, submit }: ViewProps<InfoScreen>) {
  return (
    <div className="screen">
      <h1>{screen.title}</h1>
      <Paragraphs text={screen.body} />
      <button className="btn primary" onClick={() => submit(undefined)}>
        {screen.cta ?? 'המשך'}
      </button>
    </div>
  );
}

export function ConsentView({ screen, submit }: ViewProps<ConsentScreen>) {
  const [hp, setHp] = useState('');
  return (
    <div className="screen">
      <h1>{screen.title}</h1>
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
      <button className="btn primary" onClick={() => submit('agreed', { hp: hp !== '' })}>
        {screen.agreeLabel}
      </button>
      <button className="btn secondary" onClick={() => submit('declined', { hp: hp !== '' })}>
        {screen.declineLabel}
      </button>
    </div>
  );
}

function OptionButton({
  option,
  role,
  selected,
  disabled,
  onClick,
}: {
  option: Option;
  /** radio לבחירה יחידה, checkbox לרב-ברירה — קורא מסך מקריא "2 מתוך 4" ולא "לחצן" */
  role: 'radio' | 'checkbox';
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      className={`option${selected ? ' selected' : ''}`}
      aria-checked={selected}
      disabled={disabled}
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
  return (
    <div className="screen">
      <h1 id={promptId(screen.id)}>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      <div className="options" role="radiogroup" aria-labelledby={promptId(screen.id)}>
        {options.map((o) => (
          <OptionButton
            key={o.id}
            option={o}
            role="radio"
            selected={selected === o.id}
            onClick={() => setSelected(o.id)}
          />
        ))}
      </div>
      <button
        className="btn primary"
        disabled={selected === null}
        onClick={() => submit(selected, { order: options.map((o) => o.id) })}
      >
        המשך
      </button>
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
      <h1 id={promptId(screen.id)}>{screen.prompt}</h1>
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
      <button
        className="btn primary"
        disabled={selected.length === 0}
        onClick={() => submit(selected, { order: options.map((o) => o.id) })}
      >
        המשך
      </button>
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

  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      <p className="help">
        {screen.scaleMin} = {screen.minLabel} · {screen.scaleMax} = {screen.maxLabel}
      </p>
      {items.map((it) => (
        <div key={it.id} className="matrix-item">
          <div className="matrix-label" id={`${screen.id}-${it.id}`}>
            {it.label}
          </div>
          <div className="scale" role="radiogroup" aria-labelledby={`${screen.id}-${it.id}`}>
            {scale.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={values[it.id] === v}
                aria-label={`${v}`}
                className={`scale-btn${values[it.id] === v ? ' selected' : ''}`}
                onClick={() => setValues((prev) => ({ ...prev, [it.id]: v }))}
              >
                {v}
              </button>
            ))}
            {screen.naLabel && (
              <button
                type="button"
                role="radio"
                aria-checked={values[it.id] === 'na'}
                className={`scale-btn na${values[it.id] === 'na' ? ' selected' : ''}`}
                onClick={() => setValues((prev) => ({ ...prev, [it.id]: 'na' }))}
              >
                {screen.naLabel}
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        className="btn primary"
        disabled={!complete}
        onClick={() => submit(values, { order: items.map((i) => i.id) })}
      >
        המשך
      </button>
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

  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      <div className="number-row">
        <input
          type="number"
          inputMode={screen.integer ? 'numeric' : 'decimal'}
          value={raw}
          min={screen.min}
          max={screen.max}
          step={screen.integer ? 1 : undefined}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setRaw(e.target.value)}
          className={`input${error ? ' invalid' : ''}`}
        />
        {screen.unit && <span className="unit">{screen.unit}</span>}
      </div>
      {error && (
        <p className="field-error" id={errorId} aria-live="polite">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={value === null} onClick={() => submit(value)}>
        המשך
      </button>
    </div>
  );
}

export function TextView({ screen, submit, initial }: ViewProps<TextScreen>) {
  const [text, setText] = useState(typeof initial === 'string' ? initial : '');
  const limit = textLimit(screen);
  const empty = text.trim() === '';

  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      {screen.optional && <p className="help">אפשר להשאיר ריק ולהמשיך.</p>}
      {screen.multiline ? (
        <textarea
          className="input"
          rows={5}
          value={text}
          placeholder={screen.placeholder}
          maxLength={limit}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <input
          className="input"
          type="text"
          value={text}
          placeholder={screen.placeholder}
          maxLength={limit}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {text.length > 0 && (
        <p className={`char-count${text.length >= limit ? ' at-limit' : ''}`} aria-live="polite">
          {text.length} / {limit}
        </p>
      )}
      <button
        className="btn primary"
        disabled={empty && !screen.optional}
        onClick={() => submit(empty ? null : text.trim())}
      >
        {screen.optional && empty ? 'דילוג' : 'המשך'}
      </button>
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
