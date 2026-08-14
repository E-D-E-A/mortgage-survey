// הטופס המשותף לכל מקום שבו הקונסולה מגדירה קוד אנליזה חדש: סימון, ערך של
// סימון, ומשתנה מוגרל. יושב בקובץ משלו כי שלושת המקומות חייבים להיראות ולהתנהג
// אותו דבר — שלוש העתקות של אותו טופס היו נפרדות זו מזו בלחיצה הראשונה.
//
// התווית קודמת לקוד בכוונה: התווית היא מה שכל הקונסולה תציג, והקוד הוא פרט
// טכני שנחוץ רק לקובץ הנתונים — הוא מגיע מוכן ורוב האדמינים לא יגעו בו.

import { useState } from 'react';

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

/** קוד פנוי הבא בסדרה — כדי שהאדמין לא יצטרך להמציא אחד. */
export function nextCode(prefix: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const candidate = `${prefix}${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

interface Props {
  kind: DefineKind;
  /** שינוי של הגדרה קיימת — התווית תמיד נערכת, הקוד רק כשהוא עדיין פתוח */
  renaming: boolean;
  /**
   * הקוד ננעל אחרי הפרסום הראשון של השאלון. הנימוק לנעילה — ניתוק מנתונים
   * שכבר נאספו — נכון רק כשיש נתונים, ולפני הפרסום הראשון אין. לכן עד אז
   * הקוד פתוח, ואחריו נעול לתמיד.
   */
  codeLocked?: boolean;
  suggestedCode: string;
  suggestedLabel: string;
  /**
   * הקודים התפוסים בהקשר הזה. שני סימונים עם אותו קוד אינם ניתנים להפרדה
   * בקובץ הנתונים, והאדמין לא יראה שום סימן לכך בקונסולה.
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
  // הנעילה רלוונטית רק בשינוי של הגדרה קיימת; קוד חדש תמיד נכתב מאפס
  const locked = renaming && codeLocked;
  const [label, setLabel] = useState(suggestedLabel);
  const [code, setCode] = useState(suggestedCode);
  const trimmed = code.trim();
  const codeValid = CODE_RE.test(trimmed);
  // הקוד שהטופס נפתח עליו אינו "תפוס" מבחינת עצמו — אחרת שינוי התווית בלבד
  // היה נחסם על ידי הקוד של המוגדר שנערך.
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
