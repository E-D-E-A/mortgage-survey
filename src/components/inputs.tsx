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
 * The answer already given for this screen, if there is one. Going back has to
 * show it — an empty screen after going back lies to the respondent and forces
 * them to answer all over again.
 *
 * The seeding is safe even though useState reads the initial value only once:
 * App.tsx renders the screen with key={screen.id}, so every screen change mounts
 * the component afresh.
 */
export interface ViewProps<S> {
  screen: S;
  submit: SubmitFn;
  initial?: AnswerValue;
}

/** The screen's heading — it doubles as the accessible name of the option group and of the input fields. */
function promptId(screenId: string): string {
  return `prompt-${screenId}`;
}

/**
 * The screen's heading. Moving between screens is not a page load, so focus
 * stays where the button that disappeared used to be — that is, on the body.
 * App.tsx moves focus to the heading on every screen change, and this is what
 * lets it receive focus (tabIndex={-1} = focusable from code, not by Tab).
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
 * Keyboard navigation within a single-choice group. Buttons with role="radio"
 * appear to a screen reader as a radio group, and a keyboard user accordingly
 * expects arrow keys — not a Tab stop on every option.
 *
 * The visual direction is RTL: "next" sits to the left in a horizontal list (the
 * matrix scale) and below in a vertical one, so ArrowLeft and ArrowDown advance,
 * and the other two go back.
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
    // With nothing selected yet, the first arrow press picks the end it points at
    const next = at < 0 ? (step === 1 ? 0 : values.length - 1) : (at + step + values.length) % values.length;
    select(values[next]);
    // Focus travels with the selection — that is how a native radio group behaves
    const group = e.currentTarget;
    requestAnimationFrame(() => {
      const el = group.querySelectorAll<HTMLElement>('[role="radio"]')[next];
      el?.focus();
    });
  };
}

/** Only the selected option (or the first, when none is selected) sits in the Tab order. */
function rovingTabIndex(selected: boolean, isFirst: boolean, anySelected: boolean): 0 | -1 {
  return selected || (!anySelected && isFirst) ? 0 : -1;
}

export function InfoView({ screen, submit }: ViewProps<InfoScreen>) {
  return (
    <div className="screen">
      <ScreenTitle>{screen.title}</ScreenTitle>
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
      <ScreenTitle>{screen.title}</ScreenTitle>
      <Paragraphs text={screen.body} />
      {/* honeypot — a real user neither sees nor fills this field */}
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
  tabIndex,
  onClick,
}: {
  option: Option;
  /** radio for single choice, checkbox for multi — a screen reader says "2 of 4" rather than "button" */
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
  // At the cap: the unselected options are disabled rather than silently ignoring
  // the click. An exclusive option always stays enabled — it clears the selection
  // and so can never exceed the cap.
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
  // The na column is not part of items, so it stays anchored last even when shuffling
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
  // The "not applicable" column is another value in the group, so it is part of the arrow-key path
  const cells: (number | 'na')[] = screen.naLabel ? [...scale, 'na'] : scale;

  /** The ends of the scale carry the meaning — "1" on its own tells a screen reader nothing. */
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
  // The message is shown immediately rather than on blur: a disabled "continue"
  // button is not clickable and so never takes focus out of the field — a
  // respondent who typed 15 would have been left with no explanation at all until
  // they happened to click somewhere else.
  const error = numberFieldError(screen, raw);
  const value = numberFieldValue(screen, raw);
  const errorId = `${screen.id}-error`;

  // The help text and the unit are part of the question, so they are read out
  // together with the field rather than falling through the cracks: without this a
  // screen reader announces "edit text" with no name at all
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
