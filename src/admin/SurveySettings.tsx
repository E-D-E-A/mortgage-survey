// עורך ברמת השאלון: כל מה ששייך לשאלון כולו ולא למסך אחד.
//
// כרגע יושבות כאן ההגרלות — משתני הסשן שהמנוע מגריל פעם אחת בכניסה, ושמהם
// נבנית בדיקת A/B. הן לא שייכות לשום מסך (הן קיימות לפני המסך הראשון), ולכן
// עד עכשיו לא היה בקונסולה מקום לערוך אותן בכלל.

import { useState } from 'react';
import type { SurveyConfig } from '../engine/types';
import type { Naming } from './display';
import { screenLabel, varLabel } from './display';
import { DefineForm, nextCode } from './DefineForm';
import { CloseIcon, PencilIcon, PlusIcon, TrashIcon } from './Icons';
import {
  addRandomValue,
  addRandomVar,
  defineVar,
  parseRandomValue,
  removeRandomValueAt,
  removeRandomVar,
  setRandomValueAt,
  setVarValueLabel,
  varReferences,
} from './vars';

interface Props {
  config: SurveyConfig;
  naming: Naming;
  onUpdate: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
  onClose: () => void;
}

export function SurveySettings({ config, naming, onUpdate, onClose }: Props) {
  // null = אף טופס פתוח; '' = יצירת הגרלה חדשה; שם = שינוי השם של הגרלה קיימת
  const [defining, setDefining] = useState<string | null>(null);
  const randomVars = Object.entries(config.randomVars ?? {});

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-label="משתני השאלון"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <h2>משתני השאלון</h2>
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
              onUpdate={onUpdate}
              renaming={defining === name}
              onRename={() => setDefining(name)}
              onRenameDone={() => setDefining(null)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

interface CardProps {
  name: string;
  values: (string | number)[];
  config: SurveyConfig;
  naming: Naming;
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
  onUpdate,
  renaming,
  onRename,
  onRenameDone,
}: CardProps) {
  const labels = naming.varMeta[name]?.values ?? {};

  /**
   * מחיקה שמשאירה שאלון שבור נעצרת כאן ולא בפאנל השגיאות. הוולידציה אמנם
   * תתפוס גם את מה שנשאר אחריה — הפניה למשתנה שאינו קיים, שיבוץ שלא ייפתר —
   * אבל אז השאלון כבר שבור, והאדמין צריך לדעת מה הוא עומד לעשות לפני הלחיצה.
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
          suggestedCode={name}
          suggestedLabel={naming.varMeta[name]?.label ?? ''}
          takenCodes={naming.vars}
          onCancel={onRenameDone}
          onCreate={(_code, label) => {
            onUpdate((cfg) => defineVar(cfg, name, label));
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
            {/* הערך קודם והשם אחריו — הפוך מעורך האפשרויות, כי כאן דווקא הערך
                הוא מה שהמשיב רואה: הוא זה שנכנס לנוסח במקום ‎{code}‎ */}
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
