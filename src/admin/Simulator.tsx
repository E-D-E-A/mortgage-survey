// The path check: the admin answers the questions that route, and sees exactly
// where that leads.
//
// This is the tool that turns a branching survey from "a pile of conditions" into
// "a path" — because it does not explain the rules, it runs them. The engine is
// the same simulatePath that is tested against a real run, so what is shown here
// is what will happen, not an estimate.
//
// ⚠ The pickers set answers and not variables, deliberately: s_timeline's showIf
// leans on the *answer* to s_status and not on segment, so the "shortcut" of
// setting a track by hand would display paths that do not exist.

import { useMemo } from 'react';
import { simulatePath } from '../engine/path';
import { quotaCells, quotaFullVar } from '../engine/quota';
import type { AnswerValue, Answers, Condition, Screen, SurveyConfig, Vars } from '../engine/types';
import type { Naming } from './display';
import { conditionQuestions, screenLabel, varLabel, varValueLabel } from './display';
import { CloseIcon } from './Icons';

interface Props {
  config: SurveyConfig;
  naming: Naming;
  answers: Answers;
  onAnswers: (answers: Answers) => void;
  /** The quota state the check runs under — the very session vars a real respondent gets on entry */
  quotaFull: Vars;
  onQuotaFull: (vars: Vars) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Every condition in the config, from all three mechanisms. */
function allConditions(config: SurveyConfig): Condition[] {
  return config.screens.flatMap((s) =>
    [s.showIf, ...(s.next ?? []).map((r) => r.if), ...(s.onSubmit ?? []).map((r) => r.if)].filter(
      (c): c is Condition => Boolean(c),
    ),
  );
}

/**
 * Only the questions that actually change the path. In a 62-screen survey that is
 * six of them — and that is the difference between a tool you can use and a form
 * you have to fill in again for every check.
 */
export function routingQuestions(config: SurveyConfig): Screen[] {
  const referenced = new Set(allConditions(config).flatMap(conditionQuestions));
  return config.screens.filter((s) => referenced.has(s.id));
}

export function Simulator({
  config,
  naming,
  answers,
  onAnswers,
  quotaFull,
  onQuotaFull,
  onSelect,
  onClose,
}: Props) {
  const questions = useMemo(() => routingQuestions(config), [config]);
  const cells = useMemo(() => quotaCells(config), [config]);
  const steps = useMemo(() => simulatePath(config, answers, quotaFull), [config, answers, quotaFull]);
  const last = steps[steps.length - 1];

  const set = (id: string, value: AnswerValue) => onAnswers({ ...answers, [id]: value });

  return (
    <aside className="simulator" aria-label="בדיקת מסלול">
      <div className="simulator-head">
        <strong>בדיקת מסלול</strong>
        <span className="a-hint">ענו כמו משיב, והתרשים יסמן לאן הוא מגיע</span>
        <button className="a-icon-btn" onClick={onClose} aria-label="סגירת בדיקת המסלול">
          <CloseIcon />
        </button>
      </div>

      <div className="simulator-answers">
        {questions.length === 0 && (
          <p className="a-hint">אין בשאלון תנאי שתלוי בתשובה — כל המשיבים עוברים אותו מסלול.</p>
        )}
        {questions.map((screen) => (
          <div className="sim-question" key={screen.id}>
            <button className="sim-question-label" onClick={() => onSelect(screen.id)}>
              {config.screens.indexOf(screen) + 1} · {screenLabel(screen)}
            </button>
            <AnswerPicker screen={screen} value={answers[screen.id]} onChange={(v) => set(screen.id, v)} />
          </div>
        ))}
        {Object.keys(answers).length > 0 && (
          <button className="a-btn ghost small" onClick={() => onAnswers({})}>
            ניקוי כל התשובות
          </button>
        )}
      </div>

      {/* A full quota is not something the respondent answers but the state of
          the study at the moment they arrive, so it is a separate control — and
          it is also the one thing here that cannot be checked on the live survey
          without waiting for a quota to genuinely fill */}
      {cells.length > 0 && (
        <div className="sim-quotas">
          <span className="a-label">מכסות שכבר התמלאו</span>
          {cells.map(({ mark, value }) => {
            const key = quotaFullVar(mark, value);
            return (
              <label className="a-check compact" key={key}>
                <input
                  type="checkbox"
                  checked={quotaFull[key] === true}
                  onChange={(e) => {
                    const next = { ...quotaFull };
                    if (e.target.checked) next[key] = true;
                    else delete next[key];
                    onQuotaFull(next);
                  }}
                />
                <span>
                  {varLabel(naming, mark)} = {varValueLabel(naming, mark, value)}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div className="simulator-path">
        <div className="sim-summary">
          המשיב הזה יראה {steps.length} מסכים
          {last && <> · ויסיים ב״{screenLabel(last.screen)}״</>}
        </div>
        <ol className="sim-steps">
          {steps.map(({ screen, vars }, i) => {
            const before = i === 0 ? {} : steps[i - 1].vars;
            const changed = Object.keys(vars).filter((k) => vars[k] !== before[k]);
            return (
              <li key={screen.id}>
                <button className="sim-step" onClick={() => onSelect(screen.id)}>
                  <span className="sim-step-pos">{config.screens.indexOf(screen) + 1}</span>
                  <span className="sim-step-text">{screenLabel(screen)}</span>
                </button>
                {changed.map((v) => (
                  <span className="sim-var" key={v}>
                    {varLabel(naming, v)} = {varValueLabel(naming, v, vars[v])}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

/** An answer picker per screen type — the option wording, not the ids. */
function AnswerPicker({
  screen,
  value,
  onChange,
}: {
  screen: Screen;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  if (screen.type === 'consent') {
    return (
      <select className="a-select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">— בלי תשובה —</option>
        <option value="agreed">{screen.agreeLabel}</option>
        <option value="declined">{screen.declineLabel}</option>
      </select>
    );
  }

  if (screen.type === 'single') {
    return (
      <select className="a-select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">— בלי תשובה —</option>
        {screen.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label.trim() || o.id}
          </option>
        ))}
      </select>
    );
  }

  if (screen.type === 'multi') {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <div className="sim-multi">
        {screen.options.map((o) => (
          <label className="a-check compact" key={o.id}>
            <input
              type="checkbox"
              checked={selected.has(o.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(o.id);
                else next.delete(o.id);
                onChange(screen.options.map((x) => x.id).filter((id) => next.has(id)));
              }}
            />
            <span>{o.label.trim() || o.id}</span>
          </label>
        ))}
      </div>
    );
  }

  if (screen.type === 'number') {
    return (
      <input
        className="a-input"
        type="number"
        inputMode="numeric"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }

  return (
    <input
      className="a-input"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="תשובת המשיב"
    />
  );
}
