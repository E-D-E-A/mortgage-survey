// The publish dialog: it summarises the validation, publishes a new permanent
// version and shows its number. Publishing does not touch respondents who are
// mid-survey — their version is pinned to the session.

import { useState } from 'react';
import type { ValidationIssue } from '../engine/validate';
import { publish } from './api';
import { CheckIcon, CloseIcon, ErrorIcon, WarningIcon } from './Icons';

interface Props {
  /** The survey being published — the server endpoint takes it as a parameter */
  slug: string;
  issues: ValidationIssue[];
  dirty: boolean;
  /** Saves the draft; returns false if it failed */
  onSave: () => Promise<boolean>;
  onClose: () => void;
}

type Phase =
  | { step: 'confirm' }
  | { step: 'saving' }
  | { step: 'publishing' }
  | { step: 'done'; version: string; warnings: ValidationIssue[] }
  /**
   * `found` — what the server found, when it found something concrete. `retry` is
   * off when retrying the exact same content is certain to give the same answer;
   * a button that cannot succeed is worse than no button at all.
   */
  | { step: 'failed'; message: string; found?: ValidationIssue[]; retry?: boolean };

export function PublishDialog({ slug, issues, dirty, onSave, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ step: 'confirm' });
  const [label, setLabel] = useState('');
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const busy = phase.step === 'saving' || phase.step === 'publishing';

  /**
   * Publishing publishes the draft saved on the server, not what is on screen. A
   * warning in text is not enough — an editor who skipped past it published an
   * old version and got a full success message. So when there are unsaved
   * changes the only available action is "save and publish".
   */
  async function saveThenPublish() {
    setPhase({ step: 'saving' });
    if (!(await onSave())) {
      setPhase({ step: 'failed', message: 'השמירה נכשלה, ולכן הפרסום בוטל — אחרת הייתה מתפרסמת הגרסה הישנה' });
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
        // 422 = the server-side check found what the check here missed. The
        // errors themselves come back in the response; without them the editor
        // is sent off to work out what exactly is wrong on their own.
        setPhase({
          step: 'failed',
          message: 'הבדיקה בשרת מצאה שגיאות שלא מופיעות כאן, ולכן הגרסה לא פורסמה. רעננו את הדף כדי לראות את המצב העדכני, תקנו ופרסמו שוב.',
          found: data.errors,
          retry: false,
        });
      } else if (status === 404) {
        setPhase({ step: 'failed', message: 'אין טיוטה לפרסם — לשאלון הזה עוד לא נשמר תוכן', retry: false });
      } else {
        setPhase({ step: 'failed', message: `הפרסום נכשל (קוד ${status}) — נסו שוב` });
      }
    } catch {
      setPhase({ step: 'failed', message: 'אין תקשורת עם השרת — בדקו את החיבור ונסו שוב' });
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
                <WarningIcon width={14} height={14} /> יש כאן שינויים שלא נשמרו. הפרסום לוקח את
                הטיוטה השמורה בשרת ולא את מה שעל המסך, ולכן הכפתור ישמור קודם ורק אחר כך יפרסם.
              </p>
            )}
            {errors.length > 0 ? (
              <div className="dialog-note error-note">
                <p>
                  <ErrorIcon width={14} height={14} /> אי אפשר לפרסם. צריך לתקן קודם{' '}
                  {errors.length === 1 ? 'שגיאה אחת' : `${errors.length} שגיאות`}:
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
                      <WarningIcon width={14} height={14} />{' '}
                      {warnings.length === 1 ? 'אזהרה אחת' : `${warnings.length} אזהרות`} — אפשר לפרסם
                      גם בלי לתקן:
                    </p>
                    <ul>
                      {warnings.map((w, i) => (
                        <li key={i}>{w.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <label className="a-field">
                  <span className="a-label">כינוי לגרסה, שיעזור לזהות אותה אחר כך (לא חובה, באנגלית)</span>
                  <input
                    className="a-input"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="pilot-2"
                    dir="ltr"
                  />
                </label>
                <p className="dialog-note">
                  מי שכבר התחיל לענות ימשיך בגרסה שהתחיל בה ולא יראה שינוי. רק מי שייכנס מעכשיו
                  יקבל את הגרסה החדשה.
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

        {phase.step === 'saving' && <p className="dialog-note">שומרים את הטיוטה…</p>}
        {phase.step === 'publishing' && <p className="dialog-note">מפרסמים…</p>}

        {phase.step === 'done' && (
          <>
            <p className="dialog-note success-note">
              <CheckIcon width={14} height={14} /> גרסה <bdi dir="ltr">{phase.version}</bdi> פורסמה.
              מי שייכנס לשאלון מעכשיו יקבל אותה — ייתכן עיכוב של עד דקה.
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
            <div className="dialog-note error-note">
              <p>
                <ErrorIcon width={14} height={14} /> {phase.message}
              </p>
              {phase.found && phase.found.length > 0 && (
                <ul>
                  {phase.found.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="dialog-actions">
              <button className={`a-btn ${phase.retry === false ? 'primary' : 'ghost'}`} onClick={onClose}>
                סגירה
              </button>
              {phase.retry !== false && (
                <button
                  className="a-btn primary"
                  onClick={() => void (dirty ? saveThenPublish() : doPublish())}
                >
                  ניסיון נוסף
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
