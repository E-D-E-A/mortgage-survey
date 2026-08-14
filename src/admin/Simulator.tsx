// בדיקת מסלול: האדמין עונה על השאלות שמנתבות, ורואה בדיוק לאן זה מוביל.
//
// זה הכלי שהופך שאלון מסועף מ"אוסף תנאים" ל"מסלול" — כי הוא לא מסביר את
// הכללים אלא מריץ אותם. המנוע הוא אותו simulatePath שנבדק מול ההרצה האמיתית,
// ולכן מה שמוצג כאן הוא מה שיקרה, לא הערכה.
//
// ⚠ בוררים תשובות ולא משתנים בכוונה: showIf של s_timeline נשען על *התשובה*
// ל-s_status ולא על segment, ולכן "קיצור דרך" של הצבת מסלול ידנית היה מציג
// מסלולים שלא קיימים.

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
  /** מצב המכסות שהבדיקה רצה בו — אותם משתני סשן שהמשיב האמיתי מקבל בכניסה */
  quotaFull: Vars;
  onQuotaFull: (vars: Vars) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** כל התנאים בקונפיג, מכל שלושת המנגנונים. */
function allConditions(config: SurveyConfig): Condition[] {
  return config.screens.flatMap((s) =>
    [s.showIf, ...(s.next ?? []).map((r) => r.if), ...(s.onSubmit ?? []).map((r) => r.if)].filter(
      (c): c is Condition => Boolean(c),
    ),
  );
}

/**
 * רק השאלות שבאמת משנות מסלול. בשאלון של 62 מסכים אלה שש — וזה ההבדל בין
 * כלי שאפשר להשתמש בו לבין טופס שצריך למלא מחדש בכל בדיקה.
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

      {/* מכסה מלאה אינה תשובה של המשיב אלא מצב של המחקר בזמן שהוא נכנס, ולכן
          היא בורר נפרד — וזה גם הדבר היחיד כאן שאי אפשר לבדוק בשאלון החי בלי
          לחכות שהמכסה באמת תתמלא */}
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

/** בורר תשובה לפי סוג המסך — נוסח האפשרויות, לא מזהים. */
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
