// @vitest-environment jsdom
//
// The versions surface: which version is live, what one actually said, what
// changed between two, and restoring one into the draft.
//
// The assertion that matters most is the one about what is NOT here. A
// published version is frozen because collected answers refer to it, so this
// component must offer no way to edit one — and "read-only" is only true if
// nothing on screen accepts input.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionsDialog } from './VersionsDialog';
import type { SurveyConfig } from '../engine/types';

vi.setConfig({ testTimeout: 15_000 });

const V2 = '2026-08-09.1-main';
const V1 = '2026-08-01.1-main';

const configV1: SurveyConfig = {
  version: V1,
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה', body: 'שלום', cta: 'להתחיל' },
    {
      id: 'q_age',
      type: 'single',
      prompt: 'מה גילך?',
      options: [
        { id: 'young', label: 'עד 30' },
        { id: 'older', label: 'מעל 30' },
      ],
    },
    { id: 'end_complete', type: 'end', title: 'תודה', body: 'סיימנו', variant: 'complete' },
  ],
};

// v2 drops a screen and rewords another — enough for the diff to have something
// specific to say.
const configV2: SurveyConfig = {
  version: V2,
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה חדשה', body: 'שלום', cta: 'להתחיל' },
    { id: 'end_complete', type: 'end', title: 'תודה', body: 'סיימנו', variant: 'complete' },
  ],
};

const listVersions = vi.fn();
const getVersion = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    listVersions: (slug: string) => listVersions(slug),
    getVersion: (slug: string, version: string) => getVersion(slug, version),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(opts: { dirty?: boolean } = {}) {
  listVersions.mockResolvedValue([
    { version: V2, published_at: '2026-08-09T05:03:02Z' },
    { version: V1, published_at: '2026-08-01T09:00:00Z' },
  ]);
  getVersion.mockImplementation((_slug: string, version: string) =>
    Promise.resolve({
      version,
      published_at: version === V2 ? '2026-08-09T05:03:02Z' : '2026-08-01T09:00:00Z',
      config: version === V2 ? configV2 : configV1,
    }),
  );
  const onRestore = vi.fn();
  const user = userEvent.setup();
  render(
    <VersionsDialog
      slug="main"
      draftConfig={configV2}
      draftDirty={opts.dirty ?? false}
      onRestore={onRestore}
      onClose={() => {}}
    />,
  );
  return { user, onRestore };
}

describe('the version list', () => {
  it('marks which version is live and which one it replaced', async () => {
    setup();
    const live = await screen.findByText(V2);
    const previous = await screen.findByText(V1);
    expect(within(live.closest('article')!).getByText('פעילה')).toBeDefined();
    expect(within(previous.closest('article')!).getByText('הקודמת')).toBeDefined();
  });

  it('shows the draft as its own row, so it is never mistaken for a published version', async () => {
    setup();
    const draftRow = (await screen.findByText('טיוטה')).closest('article')!;
    expect(within(draftRow).getByText('לא פורסמה')).toBeDefined();
    expect(within(draftRow).getByText(/המשיבים לא רואים אותה עד שמפרסמים/)).toBeDefined();
  });

  it('says when the draft holds edits that were never saved', async () => {
    setup({ dirty: true });
    const draftRow = (await screen.findByText('טיוטה')).closest('article')!;
    expect(within(draftRow).getByText('שינויים שלא נשמרו')).toBeDefined();
  });
});

describe('reading a published version', () => {
  it('renders its content, and offers nothing that could edit it', async () => {
    const { user } = setup();
    await user.click(await screen.findByText(V1));
    // The outline is the read-only view: the screens of v1, in order.
    expect(await screen.findByText(/מה גילך\?/)).toBeDefined();
    // Nothing on this surface accepts content. The only input is the compare
    // picker, and the only buttons are navigation, compare and restore.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/שמירה|מחיקה|הוספה/);
    }
  });

  it('compares two versions using the same diff the agent reports', async () => {
    const { user } = setup();
    await user.click(await screen.findByText(V2));
    await user.selectOptions(await screen.findByLabelText('השוואה מול'), V1);
    // v2 dropped the age question — the diff has to say so, by name.
    expect(await screen.findByText(/מסכים שהוסרו/)).toBeDefined();
    expect(screen.getByText(/מה גילך\?/)).toBeDefined();
  });
});

describe('restoring a version into the draft', () => {
  it('hands the version content back and does not publish anything', async () => {
    const { user, onRestore } = setup();
    await user.click(await screen.findByText(V1));
    await user.click(await screen.findByRole('button', { name: 'שחזור לתוך הטיוטה' }));
    await user.click(await screen.findByRole('button', { name: 'שחזור' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0][0]).toEqual(configV1);
    expect(onRestore.mock.calls[0][1]).toBe(V1);
  });

  // Unsaved edits live only in memory, so replacing them loses them outright.
  it('warns before overwriting unsaved work, and can be backed out of', async () => {
    const { user, onRestore } = setup({ dirty: true });
    await user.click(await screen.findByText(V1));
    await user.click(await screen.findByRole('button', { name: 'שחזור לתוך הטיוטה' }));
    expect(await screen.findByText(/שינויים שלא נשמרו, והם יאבדו/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('does not warn when there is nothing unsaved to lose', async () => {
    const { user } = setup({ dirty: false });
    await user.click(await screen.findByText(V1));
    await user.click(await screen.findByRole('button', { name: 'שחזור לתוך הטיוטה' }));
    expect(screen.queryByText(/והם יאבדו/)).toBeNull();
  });
});
