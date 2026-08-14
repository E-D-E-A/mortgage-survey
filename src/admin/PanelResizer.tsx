// A handle for resizing one of the two panels flanking the diagram.
// The handle sits on the panel's inner border (the one facing the diagram), so
// the drag direction that widens it depends both on which side it sits on and on
// the page's writing direction.

import { useRef } from 'react';

const RTL = document.documentElement.dir === 'rtl';

/** The keyboard step — large enough to feel, small enough to aim with */
const STEP = 24;

interface Props {
  /** The screen list sits on the start side, the editing drawer on the end side */
  edge: 'sidebar' | 'drawer';
  width: number;
  label: string;
  /** Computed live: the limits depend on the window width and on the panel opposite */
  clampWidth: (w: number) => number;
  /** done=false while dragging, true at the end — only then is it saved */
  onWidth: (w: number, done: boolean) => void;
  onReset: () => void;
}

export function PanelResizer({ edge, width, label, clampWidth, onWidth, onReset }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null);

  // Dragging left widens a right-hand panel and narrows a left-hand one — one sign covers every combination
  const sign = (edge === 'sidebar') === RTL ? -1 : 1;

  // From the starting position and not in accumulated steps, otherwise the handle "drifts" away from the cursor at the limits
  const widthAt = (clientX: number) => {
    const d = drag.current!;
    return clampWidth(Math.round(d.w + (clientX - d.x) * sign));
  };

  function end(e: React.PointerEvent) {
    if (!drag.current) return;
    onWidth(widthAt(e.clientX), true);
    drag.current = null;
    document.body.classList.remove('resizing-x');
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={`${label} — גררו, או לחצו פעמיים כדי לחזור לרוחב הרגיל`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Without this the browser starts selecting text on the panel while dragging
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.body.classList.add('resizing-x');
      }}
      onPointerMove={(e) => {
        if (drag.current) onWidth(widthAt(e.clientX), false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        onWidth(clampWidth(width + dir * sign * STEP), true);
      }}
    />
  );
}
