// עורך מסך בודד, בנוי מקטעים עם כותרת — כל קטע עונה על שאלה אחת:
//   המקום בזרימה (קריאה בלבד) · תוכן המסך · מי רואה את המסך ·
//   לאן ממשיכים מכאן · סימון המשיב.
//
// קטע ריק הוא שורה שקטה אחת, לא טופס ריק — מי שלא נוגע במנגנונים לא רואה
// אותם. הקוד לקובץ הנתונים ירד לתחתית: נחוץ לאנליזה, לא לעריכה השוטפת.

import type { ReactNode } from 'react';
import { TEXT_MAX_LENGTH } from '../engine/input-rules';
import type { Condition, Option, Screen, SurveyConfig } from '../engine/types';
import type { Naming } from './display';
import { conditionSentence, screenKindLabel, screenLabel } from './display';
import { ConditionBuilder, defaultLeaf } from './ConditionBuilder';
import { FlowContext } from './FlowContext';
import { nextChoiceId } from './edits';
import { laneMembers } from './lanes';
import { NextRulesEditor } from './NextRulesEditor';
import { SetVarEditor } from './SetVarEditor';
import { PlusIcon, TrashIcon, TypeIcon } from './Icons';

interface Props {
  config: SurveyConfig;
  screen: Screen;
  naming: Naming;
  onChange: (screen: Screen) => void;
  /** עריכת תנאי התצוגה של ענף שלם — אותה סמנטיקה כמו לחיצה על הענף בתרשים */
  onLaneShowIf: (ids: string[], cond: Condition | undefined) => void;
  onDelete: () => void;
  onSelect: (id: string) => void;
  onDefineVar: (name: string, label: string) => void;
  onDefineVarValue: (name: string, value: string, label: string) => void;
}

export function ScreenEditor({
  config,
  screen,
  naming,
  onChange,
  onLaneShowIf,
  onDelete,
  onSelect,
  onDefineVar,
  onDefineVarValue,
}: Props) {
  const patch = (p: Partial<Screen>) => onChange({ ...screen, ...p } as Screen);
  // המגירה היא המקום הגלוי יותר לעריכת תנאי — ולכן היא חייבת להתנהג בדיוק
  // כמו התרשים. עריכה שמפצלת ענף בשקט היא בדיוק הבלבול שהעורך הזה נועד למנוע.
  const lane = laneMembers(config.screens, screen.id);
  const setShowIf = (cond: Condition | undefined) =>
    lane.length > 1 ? onLaneShowIf(lane, cond) : patch({ showIf: cond });

  /**
   * היעד שכלל קפיצה חדש נולד איתו. חייב להיות המסך הבא ברשימה ולא הראשון
   * בשאלון: קפיצה אחורה היא לולאה, ושומר המעגלים היה חוסם אותה — כלומר
   * הכפתור "הוספת קפיצה" היה נראה שבור בכל מסך חוץ מהראשון.
   */
  const index = config.screens.findIndex((s) => s.id === screen.id);
  const defaultGoto = config.screens[index + 1]?.id;

  return (
    <div className="editor">
      <header className="editor-head">
        <span className="editor-type">
          <TypeIcon type={screen.type} /> {screenKindLabel(screen)}
        </span>
        <strong className="editor-name">{screenLabel(screen)}</strong>
        <button className="a-btn danger-ghost small" onClick={onDelete}>
          <TrashIcon /> מחיקת המסך
        </button>
      </header>

      <FlowContext config={config} screen={screen} naming={naming} onSelect={onSelect} />

      <Section title="תוכן המסך">
        <TypeFields screen={screen} patch={patch} />
      </Section>

      <Section
        title="מי רואה את המסך"
        action={
          screen.showIf ? (
            <button className="a-btn ghost small" onClick={() => setShowIf(undefined)}>
              הסרת התנאי
            </button>
          ) : (
            <button className="a-btn ghost small" onClick={() => setShowIf(defaultLeaf(naming))}>
              <PlusIcon /> הצגה רק בתנאי מסוים
            </button>
          )
        }
      >
        {screen.showIf ? (
          <>
            {lane.length > 1 && (
              <p className="a-hint">
                התנאי הזה משותף ל-{lane.length} מסכים שבאים ברצף — שינוי כאן חל על כולם.
              </p>
            )}
            <p className="cond-sentence">{conditionSentence(naming, screen.showIf)}</p>
            <ConditionBuilder value={screen.showIf} onChange={setShowIf} naming={naming} />
          </>
        ) : (
          <p className="ed-empty">כל מי שמגיע לכאן רואה את המסך.</p>
        )}
      </Section>

      {screen.type !== 'end' && (
        <>
          <Section
            title="לאן ממשיכים מכאן"
            action={
              <button
                className="a-btn ghost small"
                disabled={defaultGoto === undefined}
                title={
                  defaultGoto === undefined
                    ? 'זה המסך האחרון — אין לאן לקפוץ ממנו קדימה'
                    : undefined
                }
                onClick={() =>
                  defaultGoto && patch({ next: [...(screen.next ?? []), { goto: defaultGoto }] })
                }
              >
                <PlusIcon /> הוספת קפיצה
              </button>
            }
          >
            <NextRulesEditor
              rules={screen.next ?? []}
              onChange={(rules) => patch({ next: rules })}
              naming={naming}
            />
          </Section>
          <Section
            title="סימון המשיב"
            action={
              <button
                className="a-btn ghost small"
                onClick={() =>
                  patch({ onSubmit: [...(screen.onSubmit ?? []), { var: naming.vars[0] ?? '', value: '' }] })
                }
              >
                <PlusIcon /> הוספת סימון
              </button>
            }
          >
            <SetVarEditor
              rules={screen.onSubmit ?? []}
              onChange={(rules) => patch({ onSubmit: rules })}
              naming={naming}
              onDefineVar={onDefineVar}
              onDefineVarValue={onDefineVarValue}
            />
          </Section>
        </>
      )}

      <footer className="editor-foot">
        קוד המסך לקובץ הנתונים:{' '}
        <code dir="ltr" title="הקוד קבוע — התנאים והתשובות שכבר נאספו מפנים אליו">
          {screen.id}
        </code>
      </footer>
    </div>
  );
}

/** קטע עם כותרת — כל קטע עונה על שאלה אחת, והפעולה שלו יושבת ליד הכותרת. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <h3 className="ed-section-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="a-field">
      <span className="a-label">{label}</span>
      {multiline ? (
        <textarea
          className="a-input"
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className="a-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="a-field">
      <span className="a-label">{label}</span>
      <input
        className="a-input"
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="a-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: Option[];
  onChange: (options: Option[]) => void;
}) {
  function patch(i: number, opt: Option) {
    onChange(options.map((o, j) => (j === i ? opt : o)));
  }
  return (
    <div className="a-field">
      <div className="a-field-head">
        <span className="a-label">אפשרויות</span>
        <button
          className="a-btn ghost small"
          onClick={() => onChange([...options, { id: nextChoiceId('opt', options), label: '' }])}
        >
          <PlusIcon /> הוספת אפשרות
        </button>
      </div>
      {options.map((opt, i) => (
        <div className="option-row" key={i}>
          {/* הנוסח קודם והקוד אחריו: מה שהמשיב יראה הוא העיקר, והקוד נחוץ
              רק לקובץ הנתונים — אבל נשאר גלוי ולעריכה */}
          <input
            className="a-input"
            value={opt.label}
            onChange={(e) => patch(i, { ...opt, label: e.target.value })}
            placeholder="מה שהמשיב יראה"
            aria-label="נוסח האפשרות"
          />
          <input
            className="a-input option-id"
            value={opt.id}
            onChange={(e) => patch(i, { ...opt, id: e.target.value })}
            placeholder="קוד"
            aria-label="קוד האפשרות בקובץ הנתונים"
            title="קוד האפשרות בקובץ הנתונים — כך היא תיקרא בניתוח"
            dir="ltr"
          />
          <label className="a-check compact" title="כשמסמנים את האפשרות הזאת, כל האחרות מתבטלות (למשל: ״אף אחד מהם״)">
            <input
              type="checkbox"
              checked={opt.exclusive ?? false}
              onChange={(e) =>
                patch(i, e.target.checked ? { ...opt, exclusive: true } : { id: opt.id, label: opt.label })
              }
            />
            <span>בלעדית</span>
          </label>
          <button
            className="a-icon-btn danger"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            aria-label="מחיקת האפשרות"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function TypeFields({ screen, patch }: { screen: Screen; patch: (p: Partial<Screen>) => void }) {
  switch (screen.type) {
    case 'info':
      return (
        <>
          <Text label="כותרת" value={screen.title} onChange={(v) => patch({ title: v })} />
          <Text label="טקסט המסך" value={screen.body} onChange={(v) => patch({ body: v })} multiline />
          <Text
            label="כיתוב כפתור ההמשך (ריק = הכיתוב הרגיל)"
            value={screen.cta ?? ''}
            onChange={(v) => patch({ cta: v || undefined })}
          />
        </>
      );
    case 'consent':
      return (
        <>
          <Text label="כותרת" value={screen.title} onChange={(v) => patch({ title: v })} />
          <Text label="טקסט המסך" value={screen.body} onChange={(v) => patch({ body: v })} multiline />
          <Text label="כיתוב כפתור ההסכמה" value={screen.agreeLabel} onChange={(v) => patch({ agreeLabel: v })} />
          <Text label="כיתוב כפתור הסירוב" value={screen.declineLabel} onChange={(v) => patch({ declineLabel: v })} />
        </>
      );
    case 'single':
    case 'multi':
      return (
        <>
          <Text label="השאלה" value={screen.prompt} onChange={(v) => patch({ prompt: v })} multiline />
          <Text
            label="הסבר קצר שיופיע מתחת לשאלה (לא חובה)"
            value={screen.help ?? ''}
            onChange={(v) => patch({ help: v || undefined })}
          />
          <OptionsEditor options={screen.options} onChange={(options) => patch({ options })} />
          {screen.type === 'multi' && (
            <Num
              label="כמה אפשרויות מותר לסמן לכל היותר (ריק = בלי הגבלה)"
              value={screen.maxSelections}
              onChange={(v) => patch({ maxSelections: v })}
            />
          )}
          <Check
            label="להציג את האפשרויות בסדר אקראי, אחר לכל משיב"
            checked={screen.shuffleOptions ?? false}
            onChange={(v) => patch({ shuffleOptions: v || undefined })}
          />
        </>
      );
    case 'matrix':
      return (
        <>
          <Text label="השאלה" value={screen.prompt} onChange={(v) => patch({ prompt: v })} multiline />
          <div className="a-field">
            <div className="a-field-head">
              <span className="a-label">שורות המטריצה</span>
              <button
                className="a-btn ghost small"
                onClick={() =>
                  patch({ items: [...screen.items, { id: nextChoiceId('item', screen.items), label: '' }] })
                }
              >
                <PlusIcon /> הוספת שורה
              </button>
            </div>
            {screen.items.map((item, i) => (
              <div className="option-row" key={i}>
                <input
                  className="a-input"
                  value={item.label}
                  onChange={(e) =>
                    patch({ items: screen.items.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)) })
                  }
                  placeholder="מה שהמשיב יראה בשורה"
                  aria-label="נוסח השורה"
                />
                <input
                  className="a-input option-id"
                  value={item.id}
                  onChange={(e) =>
                    patch({ items: screen.items.map((it, j) => (j === i ? { ...it, id: e.target.value } : it)) })
                  }
                  placeholder="קוד"
                  aria-label="קוד השורה בקובץ הנתונים"
                  title="קוד השורה בקובץ הנתונים — כך היא תיקרא בניתוח"
                  dir="ltr"
                />
                <button
                  className="a-icon-btn danger"
                  onClick={() => patch({ items: screen.items.filter((_, j) => j !== i) })}
                  aria-label="מחיקת השורה"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
          <div className="a-grid-2">
            <Num label="הסולם מתחיל במספר" value={screen.scaleMin} onChange={(v) => patch({ scaleMin: v ?? 1 })} />
            <Num label="ונגמר במספר" value={screen.scaleMax} onChange={(v) => patch({ scaleMax: v ?? 5 })} />
          </div>
          <div className="a-grid-2">
            <Text label="הכיתוב בקצה הנמוך" value={screen.minLabel} onChange={(v) => patch({ minLabel: v })} />
            <Text label="הכיתוב בקצה הגבוה" value={screen.maxLabel} onChange={(v) => patch({ maxLabel: v })} />
          </div>
          <Text
            label='עמודת "לא רלוונטי" (ריק = בלי עמודה כזאת)'
            value={screen.naLabel ?? ''}
            onChange={(v) => patch({ naLabel: v || undefined })}
          />
          <Check
            label="להציג את השורות בסדר אקראי, אחר לכל משיב"
            checked={screen.shuffleItems ?? false}
            onChange={(v) => patch({ shuffleItems: v || undefined })}
          />
        </>
      );
    case 'number':
      return (
        <>
          <Text label="השאלה" value={screen.prompt} onChange={(v) => patch({ prompt: v })} multiline />
          <Text
            label="הסבר קצר שיופיע מתחת לשאלה (לא חובה)"
            value={screen.help ?? ''}
            onChange={(v) => patch({ help: v || undefined })}
          />
          <div className="a-grid-2">
            <Num label="המספר הנמוך ביותר שמתקבל" value={screen.min} onChange={(v) => patch({ min: v })} />
            <Num label="המספר הגבוה ביותר שמתקבל" value={screen.max} onChange={(v) => patch({ max: v })} />
          </div>
          <Text
            label="יחידת מידה שתוצג ליד השדה (למשל ש״ח)"
            value={screen.unit ?? ''}
            onChange={(v) => patch({ unit: v || undefined })}
          />
          <Check
            label="לקבל מספרים שלמים בלבד (גיל, מספר ילדים)"
            checked={screen.integer ?? false}
            onChange={(v) => patch({ integer: v || undefined })}
          />
        </>
      );
    case 'text':
      return (
        <>
          <Text label="השאלה" value={screen.prompt} onChange={(v) => patch({ prompt: v })} multiline />
          <Text
            label="הסבר קצר שיופיע מתחת לשאלה (לא חובה)"
            value={screen.help ?? ''}
            onChange={(v) => patch({ help: v || undefined })}
          />
          <Text
            label="דוגמה אפורה בתוך השדה הריק (לא חובה)"
            value={screen.placeholder ?? ''}
            onChange={(v) => patch({ placeholder: v || undefined })}
          />
          <Check
            label="שדה גדול, לתשובה של כמה שורות"
            checked={screen.multiline ?? false}
            onChange={(v) => patch({ multiline: v || undefined })}
          />
          <Check
            label="אפשר להמשיך בלי לענות"
            checked={screen.optional ?? false}
            onChange={(v) => patch({ optional: v || undefined })}
          />
          <Num
            label={`אורך מרבי בתווים (ברירת מחדל ${TEXT_MAX_LENGTH})`}
            value={screen.maxLength}
            onChange={(v) => patch({ maxLength: v })}
          />
        </>
      );
    case 'end':
      return (
        <>
          <label className="a-field">
            <span className="a-label">למה השאלון נגמר כאן</span>
            <select
              className="a-select"
              value={screen.variant}
              onChange={(e) => patch({ variant: e.target.value as 'complete' | 'screenout' | 'quotafull' })}
            >
              <option value="complete">המשיב ענה על הכול</option>
              <option value="screenout">המשיב לא מתאים למחקר</option>
              <option value="quotafull">כבר נאספו מספיק משיבים כאלה</option>
            </select>
          </label>
          <Text label="כותרת" value={screen.title} onChange={(v) => patch({ title: v })} />
          <Text label="טקסט המסך" value={screen.body} onChange={(v) => patch({ body: v })} multiline />
        </>
      );
  }
}
