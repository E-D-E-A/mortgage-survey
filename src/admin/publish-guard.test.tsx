// @vitest-environment jsdom
//
// הרגע שבו "פרסום השאלון הלא נכון" באמת קורה: הפרסום לוקח את הטיוטה **השמורה
// בשרת**, ולא את מה שעל המסך. עורך שערך, לא שמר, ולחץ "פרסום" היה מפרסם את
// הגרסה הישנה ומקבל הודעת הצלחה מלאה. זה קרה בפועל (ראו התיעוד ב-PublishDialog),
// ולכן ההתנהגות נעולה כאן:
//   • יש שינויים לא שמורים ⇒ הפעולה היחידה היא "שמירה ופרסום";
//   • השמירה נכשלה ⇒ **לא מפרסמים** ואומרים למה;
//   • יש שגיאות בדיקה ⇒ הכפתור חסום.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ValidationIssue } from '../engine/validate';
import { PublishDialog } from './PublishDialog';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('./api', () => ({ publish }));

const ok = { status: 200, data: { version: '2026-08-09.1-main', warnings: [] } };

const error: ValidationIssue = {
  level: 'error',
  code: 'dangling-goto',
  message: 'המסך "q1" קופץ אל "nope" — מסך שלא קיים',
};
const warning: ValidationIssue = {
  level: 'warning',
  code: 'unreachable',
  message: 'אי אפשר להגיע למסך "orphan"',
};

/** סדר הקריאות — שמירה חייבת להסתיים לפני שפרסום מתחיל. */
let order: string[] = [];

beforeEach(() => {
  order = [];
  publish.mockReset();
  publish.mockImplementation(async () => {
    order.push('publish');
    return ok;
  });
});

afterEach(cleanup);

function show(props: { issues?: ValidationIssue[]; dirty?: boolean; save?: () => Promise<boolean> }) {
  const onSave =
    props.save ??
    (async () => {
      order.push('save');
      return true;
    });
  const onClose = vi.fn();
  render(
    <PublishDialog
      slug="main"
      issues={props.issues ?? []}
      dirty={props.dirty ?? false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { user: userEvent.setup(), onClose };
}

describe('unsaved changes cannot become a stale published version', () => {
  it('offers "save and publish" instead of a bare publish', async () => {
    show({ dirty: true });
    expect(screen.getByRole('button', { name: 'שמירה ופרסום' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'פרסום' })).toBeNull();
  });

  it('saves first and publishes only after the save returned', async () => {
    const { user } = show({ dirty: true });
    await user.click(screen.getByRole('button', { name: 'שמירה ופרסום' }));
    expect(order).toEqual(['save', 'publish']);
    expect(publish).toHaveBeenCalledWith('main', '');
  });

  it('does not publish at all when the save failed', async () => {
    const { user } = show({
      dirty: true,
      save: async () => {
        order.push('save-failed');
        return false;
      },
    });
    await user.click(screen.getByRole('button', { name: 'שמירה ופרסום' }));
    expect(publish).not.toHaveBeenCalled();
    expect(order).toEqual(['save-failed']);
    expect(screen.getByText(/הפרסום בוטל/)).toBeDefined();
  });

  it('publishes directly when there is nothing to save', async () => {
    const { user } = show({ dirty: false });
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(order).toEqual(['publish']);
  });
});

describe('a survey with errors cannot be published from the console', () => {
  it('disables the button and shows every error', () => {
    show({ issues: [error, warning] });
    const button = screen.getByRole('button', { name: 'פרסום' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(error.message)).toBeDefined();
  });

  it('still publishes when there are only warnings, and lists them first', async () => {
    const { user } = show({ issues: [warning] });
    expect(screen.getByText(warning.message)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(publish).toHaveBeenCalled();
  });
});

describe('what the editor is told afterwards', () => {
  it('names the version that was published', async () => {
    const { user } = show({});
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(screen.getByText(/2026-08-09\.1-main/)).toBeDefined();
  });

  it('shows the server-side errors when the server refuses (422), without a retry button', async () => {
    publish.mockResolvedValue({ status: 422, data: { errors: [error] } });
    const { user } = show({});
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(screen.getByText(error.message)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'ניסיון נוסף' })).toBeNull();
  });

  it('explains a missing draft (404) instead of offering a pointless retry', async () => {
    publish.mockResolvedValue({ status: 404, data: {} });
    const { user } = show({});
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(screen.getByText(/אין טיוטה לפרסם/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'ניסיון נוסף' })).toBeNull();
  });

  it('offers a retry on a transient failure, and keeps saving first when dirty', async () => {
    let call = 0;
    publish.mockImplementation(async () => {
      order.push('publish');
      return ++call === 1 ? { status: 502, data: {} } : ok;
    });
    const { user } = show({ dirty: true });
    await user.click(screen.getByRole('button', { name: 'שמירה ופרסום' }));
    expect(screen.getByText(/קוד 502/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(order).toEqual(['save', 'publish', 'save', 'publish']);
  });

  it('reports a network failure instead of pretending it published', async () => {
    publish.mockRejectedValue(new Error('offline'));
    const { user } = show({});
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(screen.getByText(/אין תקשורת עם השרת/)).toBeDefined();
  });

  it('passes the label the editor typed to the server', async () => {
    const { user } = show({});
    await user.type(screen.getByRole('textbox'), 'pilot-2');
    await user.click(screen.getByRole('button', { name: 'פרסום' }));
    expect(publish).toHaveBeenCalledWith('main', 'pilot-2');
  });
});
