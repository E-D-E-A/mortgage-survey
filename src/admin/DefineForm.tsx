// The form shared by every place the console defines a new analysis code: a
// mark, a mark value, and a random variable. It lives in its own file because
// those three places have to look and behave identically — three copies of the
// same form would have diverged on the first click.
//
// The label comes before the code on purpose: the label is what the whole console
// will display, and the code is a technical detail needed only by the data file —
// it arrives ready-made and most admins will never touch it.

import { useState } from 'react';
import { isCodeFieldLocked } from './codeLock';

export type DefineKind = 'var' | 'value' | 'randomVar';

const FIELD_LABELS: Record<DefineKind, string> = {
  var: 'שם הסימון — כך הוא ייראה בקונסולה',
  value: 'שם הערך — כך הוא ייראה בקונסולה',
  randomVar: 'שם ההגרלה — כך היא תיראה בקונסולה',
};

const PLACEHOLDERS: Record<DefineKind, string> = {
  var: 'למשל: מסלול המשיב',
  value: 'למשל: מסלול A — יש משכנתה',
  randomVar: 'למשל: מחיר לבדיקת נכונות לשלם',
};

const CODE_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** The next free code in the series — so the admin never has to invent one. */
export function nextCode(prefix: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const candidate = `${prefix}${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

interface Props {
  kind: DefineKind;
  /** Editing an existing definition — the label is always editable, the code only while it is still open */
  renaming: boolean;
  /**
   * The code locks after the survey's first publish. The reason for the lock —
   * cutting the code off from data already collected — only holds once data
   * exists, and before the first publish there is none. So until then the code is
   * open, and after it, locked for good.
   */
  codeLocked?: boolean;
  suggestedCode: string;
  suggestedLabel: string;
  /**
   * The codes already taken in this context. Two marks sharing a code are
   * indistinguishable in the data file, and the admin will see no sign of it in
   * the console.
   */
  takenCodes?: readonly string[];
  onCreate: (code: string, label: string) => void;
  onCancel: () => void;
}

export function DefineForm({
  kind,
  renaming,
  codeLocked = true,
  suggestedCode,
  suggestedLabel,
  takenCodes = [],
  onCreate,
  onCancel,
}: Props) {
  // The lock only applies when editing an existing definition; a new code is always written from scratch
  const locked = isCodeFieldLocked(renaming, codeLocked);
  const [label, setLabel] = useState(suggestedLabel);
  const [code, setCode] = useState(suggestedCode);
  const trimmed = code.trim();
  const codeValid = CODE_RE.test(trimmed);
  // The code the form opened on is not "taken" as far as it is concerned —
  // otherwise editing the label alone would be blocked by the very code being
  // edited.
  const codeTaken = trimmed !== suggestedCode && takenCodes.includes(trimmed);
  const ready = label.trim().length > 0 && codeValid && !codeTaken;

  return (
    <form
      className="define-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCreate(trimmed, label.trim());
      }}
    >
      <label className="a-field">
        <span className="a-label">{FIELD_LABELS[kind]}</span>
        <input
          className="a-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={PLACEHOLDERS[kind]}
          autoFocus
        />
      </label>
      <label className="a-field">
        <span className="a-label">קוד לקובץ הנתונים</span>
        <input
          className="a-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          dir="ltr"
          aria-invalid={!codeValid || codeTaken}
          disabled={locked}
          title={
            locked
              ? 'הקוד קבוע — שינוי שלו היה מנתק אותו מהנתונים שכבר נאספו'
              : renaming
                ? 'השאלון עוד לא פורסם, ולכן אין נתונים שתלויים בקוד — אפשר עדיין לתקן אותו'
                : undefined
          }
        />
      </label>
      {renaming && !locked && (
        <p className="a-hint">
          שינוי הקוד יעדכן איתו את כל מה שמפנה אליו — סימונים, תנאים, מכסות ושיבוץ בנוסח.
          אחרי הפרסום הראשון הקוד יינעל.
        </p>
      )}
      <div className="define-actions">
        <button className="a-btn primary small" type="submit" disabled={!ready}>
          {renaming ? 'שמירת השם' : 'יצירה'}
        </button>
        <button className="a-btn ghost small" type="button" onClick={onCancel}>
          ביטול
        </button>
      </div>
      {!codeValid && (
        <p className="a-hint error-text">
          הקוד צריך להתחיל באות אנגלית, ולהמשיך באותיות אנגליות, ספרות או קו תחתון
        </p>
      )}
      {codeValid && codeTaken && (
        <p className="a-hint error-text">הקוד הזה כבר תפוס בשאלון — בחרו קוד אחר</p>
      )}
    </form>
  );
}
