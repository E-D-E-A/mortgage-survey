import { useMemo, useState } from 'react';
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

export function InfoView({ screen, submit }: { screen: InfoScreen; submit: SubmitFn }) {
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

export function ConsentView({ screen, submit }: { screen: ConsentScreen; submit: SubmitFn }) {
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
  selected,
  onClick,
}: {
  option: Option;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`option${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {option.label}
    </button>
  );
}

export function SingleChoiceView({ screen, submit }: { screen: SingleChoiceScreen; submit: SubmitFn }) {
  const options = useMemo(
    () => (screen.shuffleOptions ? shuffle(screen.options) : screen.options),
    [screen],
  );
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      <div className="options" role="radiogroup">
        {options.map((o) => (
          <OptionButton key={o.id} option={o} selected={selected === o.id} onClick={() => setSelected(o.id)} />
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

export function MultiChoiceView({ screen, submit }: { screen: MultiChoiceScreen; submit: SubmitFn }) {
  const options = useMemo(
    () => (screen.shuffleOptions ? shuffle(screen.options) : screen.options),
    [screen],
  );
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(o: Option) {
    setSelected((prev) => {
      if (prev.includes(o.id)) return prev.filter((id) => id !== o.id);
      if (o.exclusive) return [o.id];
      const withoutExclusive = prev.filter((id) => !options.find((x) => x.id === id)?.exclusive);
      if (screen.maxSelections && withoutExclusive.length >= screen.maxSelections) return withoutExclusive;
      return [...withoutExclusive, o.id];
    });
  }

  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      {screen.maxSelections && <p className="help">עד {screen.maxSelections} בחירות</p>}
      <div className="options">
        {options.map((o) => (
          <OptionButton key={o.id} option={o} selected={selected.includes(o.id)} onClick={() => toggle(o)} />
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

export function MatrixView({ screen, submit }: { screen: MatrixScreen; submit: SubmitFn }) {
  const items = useMemo(
    () => (screen.shuffleItems ? shuffle(screen.items) : screen.items),
    [screen],
  );
  const [values, setValues] = useState<MatrixAnswer>({});
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
          <div className="matrix-label">{it.label}</div>
          <div className="scale">
            {scale.map((v) => (
              <button
                key={v}
                type="button"
                className={`scale-btn${values[it.id] === v ? ' selected' : ''}`}
                onClick={() => setValues((prev) => ({ ...prev, [it.id]: v }))}
              >
                {v}
              </button>
            ))}
            {screen.naLabel && (
              <button
                type="button"
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

export function NumberView({ screen, submit }: { screen: NumberScreen; submit: SubmitFn }) {
  const [raw, setRaw] = useState('');
  const num = raw === '' ? null : Number(raw);
  const valid =
    num !== null &&
    Number.isFinite(num) &&
    (screen.min === undefined || num >= screen.min) &&
    (screen.max === undefined || num <= screen.max);

  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      <div className="number-row">
        <input
          type="number"
          inputMode="numeric"
          value={raw}
          min={screen.min}
          max={screen.max}
          onChange={(e) => setRaw(e.target.value)}
          className="input"
        />
        {screen.unit && <span className="unit">{screen.unit}</span>}
      </div>
      <button className="btn primary" disabled={!valid} onClick={() => submit(num)}>
        המשך
      </button>
    </div>
  );
}

export function TextView({ screen, submit }: { screen: TextScreen; submit: SubmitFn }) {
  const [text, setText] = useState('');
  return (
    <div className="screen">
      <h1>{screen.prompt}</h1>
      {screen.help && <p className="help">{screen.help}</p>}
      {screen.multiline ? (
        <textarea
          className="input"
          rows={5}
          value={text}
          placeholder={screen.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <input
          className="input"
          type="text"
          value={text}
          placeholder={screen.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <button className="btn primary" disabled={text.trim() === '' && !screen.optional} onClick={() => submit(text.trim() === '' ? null : text.trim())}>
        המשך
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
