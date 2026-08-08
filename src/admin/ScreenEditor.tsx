// עורך מסך בודד: קודם ההקשר (איך מגיעים לכאן ולאן ממשיכים), אחריו התוכן,
// ורק בסוף המנגנונים — תנאי תצוגה (showIf), קפיצות (next) וסימונים (onSubmit).
//
// הסדר הזה מכוון: מי שפותח מסך רוצה קודם לדעת איפה הוא עומד בזרימה.

import { TEXT_MAX_LENGTH } from '../engine/input-rules';
import type { Option, Screen, SurveyConfig } from '../engine/types';
import type { Naming } from './display';
import { screenKindLabel, screenLabel } from './display';
import { OptionalCondition } from './ConditionBuilder';
import { FlowContext } from './FlowContext';
import { NextRulesEditor } from './NextRulesEditor';
import { SetVarEditor } from './SetVarEditor';
import { PlusIcon, TrashIcon, TypeIcon } from './Icons';

interface Props {
  config: SurveyConfig;
  screen: Screen;
  naming: Naming;
  onChange: (screen: Screen) => void;
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
  onDelete,
  onSelect,
  onDefineVar,
  onDefineVarValue,
}: Props) {
  const patch = (p: Partial<Screen>) => onChange({ ...screen, ...p } as Screen);

  return (
    <div className="editor">
      <header className="editor-head">
        <span className="editor-type">
          <TypeIcon type={screen.type} /> {screenKindLabel(screen)}
        </span>
        <strong className="editor-name">{screenLabel(screen)}</strong>
        <code
          className="editor-id"
          dir="ltr"
          title="הקוד של המסך בקובץ הנתונים — קבוע, ותנאים מפנים אליו"
        >
          {screen.id}
        </code>
        <button className="a-btn danger-ghost small" onClick={onDelete}>
          <TrashIcon /> מחיקת המסך
        </button>
      </header>

      <FlowContext config={config} screen={screen} naming={naming} onSelect={onSelect} />

      <TypeFields screen={screen} patch={patch} />

      <hr className="a-sep" />

      <OptionalCondition
        label="מוצג רק כאשר"
        value={screen.showIf}
        onChange={(cond) => patch({ showIf: cond })}
        naming={naming}
      />

      {screen.type !== 'end' && (
        <>
          <NextRulesEditor
            rules={screen.next ?? []}
            onChange={(rules) => patch({ next: rules })}
            naming={naming}
          />
          <SetVarEditor
            rules={screen.onSubmit ?? []}
            onChange={(rules) => patch({ onSubmit: rules })}
            naming={naming}
            onDefineVar={onDefineVar}
            onDefineVarValue={onDefineVarValue}
          />
        </>
      )}
    </div>
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
          onClick={() => onChange([...options, { id: `opt_${options.length + 1}`, label: '' }])}
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
            placeholder="נוסח האפשרות"
            aria-label="נוסח אפשרות"
          />
          <input
            className="a-input option-id"
            value={opt.id}
            onChange={(e) => patch(i, { ...opt, id: e.target.value })}
            placeholder="קוד"
            aria-label="קוד האפשרות בקובץ הנתונים"
            title="קוד האפשרות בקובץ הנתונים"
            dir="ltr"
          />
          <label className="a-check compact" title="בחירה באפשרות זו מנקה את כל השאר">
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
            aria-label="מחיקת אפשרות"
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
          <Text label="גוף" value={screen.body} onChange={(v) => patch({ body: v })} multiline />
          <Text
            label="כפתור המשך (ריק = ברירת מחדל)"
            value={screen.cta ?? ''}
            onChange={(v) => patch({ cta: v || undefined })}
          />
        </>
      );
    case 'consent':
      return (
        <>
          <Text label="כותרת" value={screen.title} onChange={(v) => patch({ title: v })} />
          <Text label="גוף" value={screen.body} onChange={(v) => patch({ body: v })} multiline />
          <Text label="כפתור הסכמה" value={screen.agreeLabel} onChange={(v) => patch({ agreeLabel: v })} />
          <Text label="כפתור סירוב" value={screen.declineLabel} onChange={(v) => patch({ declineLabel: v })} />
        </>
      );
    case 'single':
    case 'multi':
      return (
        <>
          <Text label="השאלה" value={screen.prompt} onChange={(v) => patch({ prompt: v })} multiline />
          <Text
            label="טקסט עזרה (אופציונלי)"
            value={screen.help ?? ''}
            onChange={(v) => patch({ help: v || undefined })}
          />
          <OptionsEditor options={screen.options} onChange={(options) => patch({ options })} />
          {screen.type === 'multi' && (
            <Num
              label="מקסימום בחירות (ריק = בלי הגבלה)"
              value={screen.maxSelections}
              onChange={(v) => patch({ maxSelections: v })}
            />
          )}
          <Check
            label="ערבוב סדר האפשרויות"
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
              <span className="a-label">פריטים</span>
              <button
                className="a-btn ghost small"
                onClick={() =>
                  patch({ items: [...screen.items, { id: `item_${screen.items.length + 1}`, label: '' }] })
                }
              >
                <PlusIcon /> הוספת פריט
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
                  placeholder="נוסח הפריט"
                  aria-label="נוסח פריט"
                />
                <input
                  className="a-input option-id"
                  value={item.id}
                  onChange={(e) =>
                    patch({ items: screen.items.map((it, j) => (j === i ? { ...it, id: e.target.value } : it)) })
                  }
                  placeholder="קוד"
                  aria-label="קוד הפריט בקובץ הנתונים"
                  title="קוד הפריט בקובץ הנתונים"
                  dir="ltr"
                />
                <button
                  className="a-icon-btn danger"
                  onClick={() => patch({ items: screen.items.filter((_, j) => j !== i) })}
                  aria-label="מחיקת פריט"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
          <div className="a-grid-2">
            <Num label="סולם — מינימום" value={screen.scaleMin} onChange={(v) => patch({ scaleMin: v ?? 1 })} />
            <Num label="סולם — מקסימום" value={screen.scaleMax} onChange={(v) => patch({ scaleMax: v ?? 5 })} />
          </div>
          <div className="a-grid-2">
            <Text label="תווית מינימום" value={screen.minLabel} onChange={(v) => patch({ minLabel: v })} />
            <Text label="תווית מקסימום" value={screen.maxLabel} onChange={(v) => patch({ maxLabel: v })} />
          </div>
          <Text
            label='עמודת "לא רלוונטי" (ריק = בלי)'
            value={screen.naLabel ?? ''}
            onChange={(v) => patch({ naLabel: v || undefined })}
          />
          <Check
            label="ערבוב סדר הפריטים"
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
            label="טקסט עזרה (אופציונלי)"
            value={screen.help ?? ''}
            onChange={(v) => patch({ help: v || undefined })}
          />
          <div className="a-grid-2">
            <Num label="מינימום" value={screen.min} onChange={(v) => patch({ min: v })} />
            <Num label="מקסימום" value={screen.max} onChange={(v) => patch({ max: v })} />
          </div>
          <Text
            label="יחידה (למשל ש״ח)"
            value={screen.unit ?? ''}
            onChange={(v) => patch({ unit: v || undefined })}
          />
          <Check
            label="מספרים שלמים בלבד (גיל, מספר ילדים)"
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
            label="טקסט עזרה (אופציונלי)"
            value={screen.help ?? ''}
            onChange={(v) => patch({ help: v || undefined })}
          />
          <Text
            label="Placeholder"
            value={screen.placeholder ?? ''}
            onChange={(v) => patch({ placeholder: v || undefined })}
          />
          <Check
            label="תשובה ארוכה (רב-שורתית)"
            checked={screen.multiline ?? false}
            onChange={(v) => patch({ multiline: v || undefined })}
          />
          <Check
            label="אפשר לדלג (אופציונלי)"
            checked={screen.optional ?? false}
            onChange={(v) => patch({ optional: v || undefined })}
          />
          <Num
            label={`תקרת תווים (ברירת מחדל ${TEXT_MAX_LENGTH})`}
            value={screen.maxLength}
            onChange={(v) => patch({ maxLength: v })}
          />
        </>
      );
    case 'end':
      return (
        <>
          <label className="a-field">
            <span className="a-label">סוג סיום</span>
            <select
              className="a-select"
              value={screen.variant}
              onChange={(e) => patch({ variant: e.target.value as 'complete' | 'screenout' | 'quotafull' })}
            >
              <option value="complete">השלמה (complete)</option>
              <option value="screenout">סינון (screenout)</option>
              <option value="quotafull">מכסה מלאה (quotafull)</option>
            </select>
          </label>
          <Text label="כותרת" value={screen.title} onChange={(v) => patch({ title: v })} />
          <Text label="גוף" value={screen.body} onChange={(v) => patch({ body: v })} multiline />
        </>
      );
  }
}
