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
import { TYPE_LABELS, screenExcerpt } from './labels';
import { BranchIcon, ErrorIcon, EyeIcon, GripIcon, PlusIcon, TypeIcon, VarIcon, WarningIcon } from './Icons';

interface ListProps {
  screens: Screen[];
  selectedId: string | null;
  issues: ValidationIssue[];
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (type: Screen['type'], id: string) => void;
}

export function ScreenList({ screens, selectedId, issues, onSelect, onReorder, onAdd }: ListProps) {
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
  index,
  selected,
  incoming,
  issues,
  onSelect,
}: {
  screen: Screen;
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
        aria-label={`גרירת המסך ${screen.id} לשינוי מיקומו`}
        title="גרירה לשינוי סדר"
      >
        <GripIcon />
      </button>
      <button className="screen-item-body" onClick={onSelect} aria-current={selected}>
        <span className="screen-item-top">
          <span className="screen-index">{index + 1}</span>
          <span className="screen-type-icon">
            <TypeIcon type={screen.type} />
          </span>
          <code className="screen-id" dir="ltr">{screen.id}</code>
          <span className="screen-type-label">{TYPE_LABELS[screen.type]}</span>
          {hasError && (
            <span className="badge badge-error" title="שגיאות ולידציה">
              <ErrorIcon width={12} height={12} />
            </span>
          )}
          {!hasError && hasWarning && (
            <span className="badge badge-warning" title="אזהרות ולידציה">
              <WarningIcon width={12} height={12} />
            </span>
          )}
        </span>
        <span className="screen-excerpt">{screenExcerpt(screen)}</span>
        {(screen.showIf || gotos.length > 0 || incoming.length > 0 || vars.length > 0) && (
          <span className="screen-badges">
            {screen.showIf && (
              <span className="badge" title="מוצג בתנאי">
                <EyeIcon width={12} height={12} /> מותנה
              </span>
            )}
            {gotos.map((g, i) => (
              <span key={i} className="badge" title={`ניתוב אל ${g}`}>
                <BranchIcon width={12} height={12} /> <bdi dir="ltr">{g}</bdi>
              </span>
            ))}
            {incoming.length > 0 && (
              <span className="badge" title={`נכנסים מ: ${incoming.join(', ')}`}>
                ← {incoming.length} קפיצות
              </span>
            )}
            {vars.map((v) => (
              <span key={v} className="badge" title={`מציב את המשתנה ${v}`}>
                <VarIcon width={12} height={12} /> <bdi dir="ltr">{v}</bdi>
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
  const [id, setId] = useState('');
  const trimmed = id.trim();
  const idTaken = screens.some((s) => s.id === trimmed);
  const idValid = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed) && !idTaken;

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
        setId('');
        setOpen(false);
      }}
    >
      <select className="a-select" value={type} onChange={(e) => setType(e.target.value as Screen['type'])}>
        {NEW_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        className="a-input"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="מזהה באנגלית, למשל s_income"
        dir="ltr"
        autoFocus
      />
      <button className="a-btn primary small" type="submit" disabled={!idValid}>
        הוספה
      </button>
      <button className="a-btn ghost small" type="button" onClick={() => setOpen(false)}>
        ביטול
      </button>
      {trimmed && !idValid && (
        <p className="a-hint error-text">
          {idTaken ? 'המזהה כבר קיים' : 'מזהה חוקי: אותיות אנגליות, ספרות וקו תחתון, מתחיל באות'}
        </p>
      )}
    </form>
  );
}
