// The survey-level editor: everything that belongs to the survey as a whole
// rather than to one screen.
//
// Two things live here, both for the same reason — neither belongs to any screen:
//   - draws: the session variables the engine draws once on entry, before the
//     first screen, and out of which an A/B test is built;
//   - quotas: a respondent ceiling for a mark value. The mark is set on one
//     screen, but the quota is a decision about the sample as a whole.

import { useState } from 'react';
import type { SurveyConfig } from '../engine/types';
import type { Naming } from './display';
import { screenLabel, varLabel, varValueLabel } from './display';
import { DefineForm, nextCode } from './DefineForm';
import { CloseIcon, PencilIcon, PlusIcon, TrashIcon } from './Icons';
import {
  addRandomValue,
  addRandomVar,
  defineVar,
  marks,
  parseRandomValue,
  removeRandomValueAt,
  removeRandomVar,
  renameVar,
  setQuota,
  setRandomValueAt,
  setVarValueLabel,
  varReferences,
} from './vars';

interface Props {
  config: SurveyConfig;
  naming: Naming;
  /** The analysis codes are locked — that is, the survey has been published at least once */
  codesLocked: boolean;
  onUpdate: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
  onClose: () => void;
}

export function SurveySettings({ config, naming, codesLocked, onUpdate, onClose }: Props) {
  // null = no form open; '' = creating a new draw; a name = editing an existing draw
  const [defining, setDefining] = useState<string | null>(null);
  const randomVars = Object.entries(config.randomVars ?? {});

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-label="משתנים ומכסות"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <h2>משתנים ומכסות</h2>
          <button className="a-icon-btn" onClick={onClose} aria-label="סגירה" title="סגירה">
            <CloseIcon />
          </button>
        </header>

        <section className="ed-section">
          <div className="ed-section-head">
            <h3 className="ed-section-title">הגרלות — בדיקת A/B</h3>
            <button className="a-btn ghost small" onClick={() => setDefining('')}>
              <PlusIcon /> יצירת הגרלה
            </button>
          </div>
          <p className="ed-empty">
            ערך אחד מהרשימה מוגרל לכל משיב ברגע שהוא נכנס, ונשאר איתו עד סוף השאלון. אפשר
            להתנות עליו הצגת מסכים, ואפשר לשבץ אותו בתוך נוסח של שאלה — כותבים את הקוד
            בסוגריים מסולסלים, למשל <code dir="ltr">{'{price}'}</code>.
          </p>

          {defining === '' && (
            <DefineForm
              kind="randomVar"
              renaming={false}
              suggestedCode={nextCode('rand', naming.vars)}
              suggestedLabel=""
              takenCodes={naming.vars}
              onCancel={() => setDefining(null)}
              onCreate={(code, label) => {
                onUpdate((cfg) => addRandomVar(cfg, code, label));
                setDefining(null);
              }}
            />
          )}

          {randomVars.length === 0 && defining !== '' && (
            <p className="ed-empty">אין בשאלון אף הגרלה — כל המשיבים רואים בדיוק את אותו נוסח.</p>
          )}

          {randomVars.map(([name, values]) => (
            <RandomVarCard
              key={name}
              name={name}
              values={values}
              config={config}
              naming={naming}
              codesLocked={codesLocked}
              onUpdate={onUpdate}
              renaming={defining === name}
              onRename={() => setDefining(name)}
              onRenameDone={() => setDefining(null)}
            />
          ))}
        </section>

        <QuotaSection config={config} naming={naming} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

/**
 * Quotas: a ceiling per mark value. An empty field is "unlimited" — 0 is a real
 * quota (a closed cell that takes no more respondents), which is exactly why it
 * must not be what an empty field means.
 */
function QuotaSection({
  config,
  naming,
  onUpdate,
}: {
  config: SurveyConfig;
  naming: Naming;
  onUpdate: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
}) {
  const list = marks(config);

  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <h3 className="ed-section-title">מכסות — כמה משיבים לכל פרסונה</h3>
      </div>
      <p className="ed-empty">
        מכסה עוצרת איסוף של פרסונה שכבר יש ממנה מספיק: ברגע שמספר המשיבים שסיימו עם הערך
        הזה מגיע למכסה, מי שיסומן בו יישלח למסך הסיום ״כבר נאספו מספיק משיבים כאלה״. שדה
        ריק = בלי הגבלה.
      </p>

      {list.length === 0 && (
        <p className="ed-empty">אין בשאלון סימונים — מכסה נקבעת על ערך של סימון.</p>
      )}

      {list.map((mark) => (
        <div className="rule-card" key={mark.name}>
          <div className="rule-head">
            <strong>{varLabel(naming, mark.name)}</strong>
            <code className="var-code" dir="ltr">
              {mark.name}
            </code>
          </div>
          {mark.values.length === 0 ? (
            <p className="ed-empty">לסימון הזה עדיין אין ערכים — אין על מה לקבוע מכסה.</p>
          ) : (
            mark.values.map((value) => (
              <div className="option-row quota-row" key={value}>
                <span className="quota-value">{varValueLabel(naming, mark.name, value)}</span>
                <code className="var-code" dir="ltr">
                  {value}
                </code>
                <span className="spacer" />
                <input
                  className="a-input quota-limit"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={config.varMeta?.[mark.name]?.quotas?.[value] ?? ''}
                  onChange={(e) =>
                    onUpdate((cfg) =>
                      setQuota(
                        cfg,
                        mark.name,
                        value,
                        e.target.value === '' ? undefined : Number(e.target.value),
                      ),
                    )
                  }
                  placeholder="בלי הגבלה"
                  aria-label={`מכסה ל״${varValueLabel(naming, mark.name, value)}״`}
                />
              </div>
            ))
          )}
        </div>
      ))}
    </section>
  );
}

interface CardProps {
  name: string;
  values: (string | number)[];
  config: SurveyConfig;
  naming: Naming;
  codesLocked: boolean;
  onUpdate: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
  renaming: boolean;
  onRename: () => void;
  onRenameDone: () => void;
}

function RandomVarCard({
  name,
  values,
  config,
  naming,
  codesLocked,
  onUpdate,
  renaming,
  onRename,
  onRenameDone,
}: CardProps) {
  const labels = naming.varMeta[name]?.values ?? {};

  /**
   * A deletion that would leave the survey broken is stopped here rather than in
   * the validation panel. Validation does catch what it leaves behind — a
   * reference to a variable that no longer exists, an interpolation that cannot
   * resolve — but by then the survey is already broken, and the admin should know
   * what they are about to do before they click.
   */
  function remove() {
    const refs = varReferences(config, name);
    const where = [...new Set(refs.map((r) => r.screenId))]
      .map((id) => `״${screenLabel(config.screens.find((s) => s.id === id)!)}״`)
      .join(', ');
    const question = refs.length
      ? `ההגרלה ״${varLabel(naming, name)}״ עדיין בשימוש ב-${refs.length === 1 ? 'מסך' : `${new Set(refs.map((r) => r.screenId)).size} מסכים`}: ${where}.\n\nמחיקה תשבור אותם. למחוק בכל זאת?`
      : `למחוק את ההגרלה ״${varLabel(naming, name)}״?`;
    if (!window.confirm(question)) return;
    onUpdate((cfg) => removeRandomVar(cfg, name));
  }

  return (
    <div className="rule-card">
      <div className="rule-head">
        <strong>{varLabel(naming, name)}</strong>
        <code className="var-code" dir="ltr" title="הקוד שבו משבצים אותה בנוסח ובתנאים">
          {name}
        </code>
        <span className="spacer" />
        <button
          className="a-icon-btn"
          onClick={onRename}
          title="שינוי השם שמוצג להגרלה"
          aria-label="שינוי השם שמוצג להגרלה"
        >
          <PencilIcon />
        </button>
        <button className="a-icon-btn danger" onClick={remove} aria-label="מחיקת ההגרלה">
          <TrashIcon />
        </button>
      </div>

      {renaming && (
        <DefineForm
          kind="randomVar"
          renaming
          codeLocked={codesLocked}
          suggestedCode={name}
          suggestedLabel={naming.varMeta[name]?.label ?? ''}
          takenCodes={naming.vars}
          onCancel={onRenameDone}
          onCreate={(code, label) => {
            // The rename and the label written in the same update — otherwise
            // half the action could be undone on its own, leaving the config with
            // the new code and the old one's label
            onUpdate((cfg) => defineVar(renameVar(cfg, name, code), code, label));
            onRenameDone();
          }}
        />
      )}

      <div className="a-field">
        <div className="a-field-head">
          <span className="a-label">הערכים שמוגרלים</span>
          <button className="a-btn ghost small" onClick={() => onUpdate((cfg) => addRandomValue(cfg, name))}>
            <PlusIcon /> הוספת ערך
          </button>
        </div>
        {values.map((value, i) => (
          <div className="option-row" key={i}>
            {/* The value first and the name after it — the reverse of the options
                editor, because here it is the value the respondent sees: it is
                what goes into the wording in place of `{code}` */}
            <input
              className="a-input"
              value={String(value)}
              onChange={(e) => onUpdate((cfg) => setRandomValueAt(cfg, name, i, e.target.value))}
              onBlur={(e) =>
                onUpdate((cfg) => setRandomValueAt(cfg, name, i, parseRandomValue(e.target.value)))
              }
              dir="ltr"
              placeholder="הערך עצמו"
              aria-label="הערך שמוגרל"
              // The drawn value is stored in the respondent's vars and shown to
              // them inside the wording, so it is data in every sense — it locks
              // after publishing exactly like a code. Adding and removing stay
              // open: neither changes what has already been collected.
              disabled={codesLocked}
              title={
                codesLocked
                  ? 'הערך קבוע — שינוי שלו היה מנתק אותו מהתשובות שכבר נאספו. אפשר להוסיף ערך חדש או להסיר ערך מההגרלה'
                  : undefined
              }
            />
            <input
              className="a-input"
              value={labels[String(value)] ?? ''}
              onChange={(e) =>
                onUpdate((cfg) => setVarValueLabel(cfg, name, String(value), e.target.value))
              }
              placeholder="שם לתצוגה בקונסולה (לא חובה)"
              aria-label="שם הערך בקונסולה"
            />
            <button
              className="a-icon-btn danger"
              onClick={() => onUpdate((cfg) => removeRandomValueAt(cfg, name, i))}
              aria-label="מחיקת הערך"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        {values.length < 2 && (
          <p className="a-hint error-text">
            צריך לפחות שני ערכים — עם ערך אחד כל המשיבים מקבלים את אותו הדבר ואין מה להשוות
          </p>
        )}
      </div>
    </div>
  );
}
