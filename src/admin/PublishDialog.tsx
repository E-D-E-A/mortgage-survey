// דיאלוג פרסום: מסכם ולידציה, מפרסם גרסה קבועה חדשה ומציג את מספרה.
// פרסום לא נוגע במשיבים באמצע שאלון — הגרסה שלהם מוצמדת לסשן.

import { useState } from 'react';
import type { ValidationIssue } from '../engine/validate';
import { publish } from './api';
import { CheckIcon, CloseIcon, ErrorIcon, WarningIcon } from './Icons';

interface Props {
  /** השאלון שמפרסמים — הקצה בשרת מקבל אותו כפרמטר */
  slug: string;
  issues: ValidationIssue[];
  dirty: boolean;
  /** שמירת הטיוטה; מחזירה false אם נכשלה */
  onSave: () => Promise<boolean>;
  onClose: () => void;
}

type Phase =
  | { step: 'confirm' }
  | { step: 'saving' }
  | { step: 'publishing' }
  | { step: 'done'; version: string; warnings: ValidationIssue[] }
  | { step: 'failed'; message: string };

export function PublishDialog({ slug, issues, dirty, onSave, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ step: 'confirm' });
  const [label, setLabel] = useState('');
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const busy = phase.step === 'saving' || phase.step === 'publishing';

  /**
   * פרסום מפרסם את הטיוטה השמורה בשרת, לא את מה שעל המסך. אזהרה בטקסט לא
   * מספיקה — עורך שדילג עליה פרסם גרסה ישנה וקיבל הודעת הצלחה מלאה. לכן
   * כשיש שינויים לא שמורים הפעולה היחידה היא "שמירה ופרסום".
   */
  async function saveThenPublish() {
    setPhase({ step: 'saving' });
    if (!(await onSave())) {
      setPhase({ step: 'failed', message: 'השמירה נכשלה — הפרסום בוטל, כדי לא לפרסם גרסה ישנה' });
      return;
    }
    await doPublish();
  }

  async function doPublish() {
    setPhase({ step: 'publishing' });
    try {
      const { status, data } = await publish(slug, label);
      if (status === 200 && data.version) {
        setPhase({ step: 'done', version: data.version, warnings: data.warnings ?? [] });
      } else if (status === 422) {
        setPhase({ step: 'failed', message: 'הוולידציה בשרת מצאה שגיאות — רעננו ותקנו לפני פרסום' });
      } else if (status === 404) {
        setPhase({ step: 'failed', message: 'אין טיוטה לפרסם' });
      } else {
        setPhase({ step: 'failed', message: `הפרסום נכשל (${status}) — נסו שוב` });
      }
    } catch {
      setPhase({ step: 'failed', message: 'שגיאת רשת — נסו שוב' });
    }
  }

  return (
    <div className="dialog-backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="פרסום גרסה" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-head">
          <h2>פרסום גרסה חדשה</h2>
          {!busy && (
            <button className="a-icon-btn" onClick={onClose} aria-label="סגירה">
              <CloseIcon />
            </button>
          )}
        </header>

        {phase.step === 'confirm' && (
          <>
            {dirty && (
              <p className="dialog-note warning-note">
                <WarningIcon width={14} height={14} /> יש שינויים שלא נשמרו — הפרסום מפרסם את הטיוטה
                השמורה בשרת, לא את מה שעל המסך. "שמירה ופרסום" ישמור אותם קודם.
              </p>
            )}
            {errors.length > 0 ? (
              <div className="dialog-note error-note">
                <p>
                  <ErrorIcon width={14} height={14} /> אי אפשר לפרסם — {errors.length} שגיאות ולידציה:
                </p>
                <ul>
                  {errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                {warnings.length > 0 && (
                  <div className="dialog-note warning-note">
                    <p>
                      <WarningIcon width={14} height={14} /> {warnings.length} אזהרות (לא חוסמות):
                    </p>
                    <ul>
                      {warnings.map((w, i) => (
                        <li key={i}>{w.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <label className="a-field">
                  <span className="a-label">תווית לגרסה (אופציונלי, באנגלית)</span>
                  <input
                    className="a-input"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="pilot-2"
                    dir="ltr"
                  />
                </label>
                <p className="dialog-note">
                  משיבים שכבר התחילו לענות לא יושפעו — הגרסה שלהם מוצמדת לסשן. רק סשנים חדשים
                  יקבלו את הגרסה החדשה.
                </p>
              </>
            )}
            <footer className="dialog-actions">
              <button className="a-btn ghost" onClick={onClose}>
                ביטול
              </button>
              <button
                className="a-btn primary"
                onClick={() => void (dirty ? saveThenPublish() : doPublish())}
                disabled={errors.length > 0}
              >
                {dirty ? 'שמירה ופרסום' : 'פרסום'}
              </button>
            </footer>
          </>
        )}

        {phase.step === 'saving' && <p className="dialog-note">שומר את הטיוטה…</p>}
        {phase.step === 'publishing' && <p className="dialog-note">מפרסם…</p>}

        {phase.step === 'done' && (
          <>
            <p className="dialog-note success-note">
              <CheckIcon width={14} height={14} /> פורסמה גרסה <bdi dir="ltr">{phase.version}</bdi>.
              סשנים חדשים יקבלו אותה מעכשיו (עד דקה בגלל cache).
            </p>
            <footer className="dialog-actions">
              <button className="a-btn primary" onClick={onClose}>
                סגירה
              </button>
            </footer>
          </>
        )}

        {phase.step === 'failed' && (
          <>
            <p className="dialog-note error-note">
              <ErrorIcon width={14} height={14} /> {phase.message}
            </p>
            <footer className="dialog-actions">
              <button className="a-btn ghost" onClick={onClose}>
                סגירה
              </button>
              <button
                className="a-btn primary"
                onClick={() => void (dirty ? saveThenPublish() : doPublish())}
              >
                ניסיון נוסף
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
