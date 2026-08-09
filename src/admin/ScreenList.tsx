// רשימת המסכים — הלב של הקונסולה. סדר הרשימה הוא סדר הזרימה ברירת-המחדל
// (המנוע סורק קדימה), ולכן גרירה ושחרור כאן היא שינוי ניתוב לכל דבר.
// ענפים מוצגים כתגיות: תנאי תצוגה, קפיצות goto יוצאות ונכנסות, משתנים.

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Screen } from '../engine/types';
import type { ValidationIssue } from '../engine/validate';
import type { Naming } from './display';
import { TYPE_LABELS } from './labels';
import { screenKindLabel, screenLabel, screenRef, varLabel } from './display';
import { uniqueId } from './edits';
import { BranchIcon, ErrorIcon, EyeIcon, GripIcon, PlusIcon, TypeIcon, VarIcon, WarningIcon } from './Icons';

interface ListProps {
  screens: Screen[];
  naming: Naming;
  selectedId: string | null;
  issues: ValidationIssue[];
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (type: Screen['type'], id: string) => void;
}

export function ScreenList({ screens, naming, selectedId, issues, onSelect, onReorder, onAdd }: ListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // goto נכנסים: יעד ← מקורות
  const incoming = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of screens) {
      for (const rule of s.next ?? []) {
        map.set(rule.goto, [...(map.get(rule.goto) ?? []), s.id]);
      }
    }
    return map;
  }, [screens]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = screens.findIndex((s) => s.id === active.id);
    const to = screens.findIndex((s) => s.id === over.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  }

  return (
    <div className="screen-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="screen-items">
            {screens.map((screen, i) => (
              <SortableItem
                key={screen.id}
                screen={screen}
                naming={naming}
                index={i}
                selected={screen.id === selectedId}
                incoming={incoming.get(screen.id) ?? []}
                issues={issues.filter((iss) => iss.screenId === screen.id)}
                onSelect={() => onSelect(screen.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <AddScreenForm screens={screens} onAdd={onAdd} />
    </div>
  );
}

function SortableItem({
  screen,
  naming,
  index,
  selected,
  incoming,
  issues,
  onSelect,
}: {
  screen: Screen;
  naming: Naming;
  index: number;
  selected: boolean;
  incoming: string[];
  issues: ValidationIssue[];
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: screen.id,
  });
  const hasError = issues.some((i) => i.level === 'error');
  const hasWarning = issues.some((i) => i.level === 'warning');
  const gotos = (screen.next ?? []).map((r) => r.goto);
  const vars = [...new Set((screen.onSubmit ?? []).map((r) => r.var))];
  const label = (id: string) => screenRef(naming, id);
  const varName = (v: string) => varLabel(naming, v);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'screen-item',
        selected ? 'selected' : '',
        isDragging ? 'dragging' : '',
        screen.type === 'end' ? 'is-end' : '',
      ].join(' ')}
    >
      <button
        className="drag-handle"
        {...attributes}
        {...listeners}
        aria-label={`גרירת המסך ״${screenLabel(screen)}״ לשינוי מיקומו`}
        title="גרירה כדי להזיז את המסך ברצף"
      >
        <GripIcon />
      </button>
      <button className="screen-item-body" onClick={onSelect} aria-current={selected}>
        <span className="screen-item-top">
          <span className="screen-index">{index + 1}</span>
          <span className="screen-type-icon">
            <TypeIcon type={screen.type} />
          </span>
          <span className="screen-type-label">{screenKindLabel(screen)}</span>
          {hasError && (
            <span className="badge badge-error" title="יש כאן שגיאה שחוסמת פרסום">
              <ErrorIcon width={12} height={12} />
            </span>
          )}
          {!hasError && hasWarning && (
            <span className="badge badge-warning" title="יש כאן אזהרה — כדאי לבדוק, אבל אפשר לפרסם">
              <WarningIcon width={12} height={12} />
            </span>
          )}
        </span>
        <span className="screen-name">{screenLabel(screen)}</span>
        {(screen.showIf || gotos.length > 0 || incoming.length > 0 || vars.length > 0) && (
          <span className="screen-badges">
            {screen.showIf && (
              <span className="badge" title="המסך מוצג רק למי שעונה על תנאי מסוים">
                <EyeIcon width={12} height={12} /> מוצג בתנאי
              </span>
            )}
            {gotos.length > 0 && (
              <span className="badge" title={`קופץ אל: ${gotos.map((g) => label(g)).join(' · ')}`}>
                <BranchIcon width={12} height={12} />{' '}
                {gotos.length === 1 ? 'קפיצה אחת מכאן' : `${gotos.length} קפיצות מכאן`}
              </span>
            )}
            {incoming.length > 0 && (
              <span className="badge" title={`קופצים לכאן מ: ${incoming.map((g) => label(g)).join(' · ')}`}>
                ← {incoming.length === 1 ? 'קפיצה אחת לכאן' : `${incoming.length} קפיצות לכאן`}
              </span>
            )}
            {vars.map((v) => (
              <span key={v} className="badge" title="המסך הזה מסמן כאן את המשיב">
                <VarIcon width={12} height={12} /> {varName(v)}
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

const NEW_TYPES: Screen['type'][] = ['info', 'consent', 'single', 'multi', 'matrix', 'number', 'text', 'end'];

function AddScreenForm({ screens, onAdd }: { screens: Screen[]; onAdd: ListProps['onAdd'] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Screen['type']>('single');
  // הקוד מגיע מוכן: אדמין לא-טכני לא אמור להמציא מזהה כדי להוסיף שאלה, אבל
  // הוא כן נשאר גלוי ולעריכה — זה השם שהחוקר יראה בקובץ הנתונים
  const [id, setId] = useState(() => uniqueId('screen', screens));
  const [touched, setTouched] = useState(false);
  const trimmed = id.trim();
  const idTaken = screens.some((s) => s.id === trimmed);
  const idValid = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed) && !idTaken;

  function reset() {
    setId(uniqueId('screen', screens));
    setTouched(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="a-btn ghost add-screen" onClick={() => setOpen(true)}>
        <PlusIcon /> הוספת מסך
      </button>
    );
  }
  return (
    <form
      className="add-screen-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!idValid) return;
        onAdd(type, trimmed);
        reset();
      }}
    >
      <select className="a-select" value={type} onChange={(e) => setType(e.target.value as Screen['type'])}>
        {NEW_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <button className="a-btn primary small" type="submit" disabled={!idValid}>
        הוספה
      </button>
      <button className="a-btn ghost small" type="button" onClick={reset}>
        ביטול
      </button>
      <details className="add-screen-code" open={touched}>
        <summary>קוד המסך לקובץ הנתונים</summary>
        <input
          className="a-input"
          value={id}
          onChange={(e) => {
            setTouched(true);
            setId(e.target.value);
          }}
          dir="ltr"
          aria-label="קוד המסך לקובץ הנתונים"
        />
        {trimmed && !idValid && (
          <p className="a-hint error-text">
            {idTaken
              ? 'הקוד הזה כבר תפוס על ידי מסך אחר'
              : 'הקוד צריך להתחיל באות אנגלית, ולהמשיך באותיות אנגליות, ספרות או קו תחתון'}
          </p>
        )}
      </details>
    </form>
  );
}
