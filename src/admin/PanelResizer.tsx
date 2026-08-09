// ידית לשינוי רוחב של אחד משני הפאנלים שמשני צדי התרשים.
// הידית יושבת על הגבול הפנימי של הפאנל (זה שפונה אל התרשים), ולכן כיוון
// הגרירה שמרחיב אותו תלוי גם בצד שבו הוא יושב וגם בכיוון הכתיבה של הדף.

import { useRef } from 'react';

const RTL = document.documentElement.dir === 'rtl';

/** צעד מקלדת — מספיק גדול כדי להרגיש, מספיק קטן כדי לכוון */
const STEP = 24;

interface Props {
  /** רשימת המסכים יושבת בצד ההתחלה, מגירת העריכה בצד הסיום */
  edge: 'sidebar' | 'drawer';
  width: number;
  label: string;
  /** מחושב בזמן אמת: הגבולות תלויים ברוחב החלון ובפאנל שממול */
  clampWidth: (w: number) => number;
  /** done=false בזמן גרירה, true בסופה — רק אז שומרים */
  onWidth: (w: number, done: boolean) => void;
  onReset: () => void;
}

export function PanelResizer({ edge, width, label, clampWidth, onWidth, onReset }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null);

  // גרירה שמאלה מרחיבה פאנל ימני ומצרה פאנל שמאלי — סימן אחד לכל הצירופים
  const sign = (edge === 'sidebar') === RTL ? -1 : 1;

  // מהמיקום ההתחלתי ולא בצעדים מצטברים, אחרת הידית "נסחפת" מהסמן בקצוות
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
        // בלי זה הדפדפן מתחיל בחירת טקסט על הפאנל בזמן הגרירה
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
