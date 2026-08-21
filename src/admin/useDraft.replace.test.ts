// @vitest-environment jsdom
//
// Restoring a published version, at the layer where it actually lands.
//
// This exists because the dialog's own tests cannot see it: they assert that
// `onRestore` was called, with `onRestore` a spy. The first implementation
// routed restore through `update()`, an edit primitive that returns early when
// there is no config — so restoring into a survey with no draft, or one whose
// draft failed to load, closed the dialog and did nothing at all. Those are
// exactly the states someone reaches for restore in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDraft } from './useDraft';
import type { SurveyConfig } from '../engine/types';

const restored: SurveyConfig = {
  version: '2026-08-01.1-main',
  screens: [
    { id: 'intro', type: 'info', title: 'משוחזר', body: '' },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

const existing: SurveyConfig = {
  version: 'draft',
  screens: [
    { id: 'intro', type: 'info', title: 'קיים', body: '' },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

const getDraft = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, getDraft: (slug: string) => getDraft(slug) };
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

// A stable callback: useDraft's load effect depends on it, so a fresh arrow on
// every render would re-fire the load and knock the phase back to 'loading'.
const noop = () => {};

const mount = async (phase: 'ready' | 'empty') => {
  getDraft.mockResolvedValue(
    phase === 'ready'
      ? { config: existing, updated_at: '2026-08-19T10:00:00Z' }
      : { config: null, updated_at: null },
  );
  const hook = renderHook(() => useDraft('main', noop));
  await waitFor(() => expect(hook.result.current.phase).toBe(phase));
  return hook;
};

describe('replace — restoring a version into the draft', () => {
  it('loads the version into a survey that already has a draft', async () => {
    const { result } = await mount('ready');
    act(() => result.current.replace(restored));
    expect(result.current.config).toEqual(restored);
    expect(result.current.dirty).toBe(true);
  });

  // The case the first implementation silently dropped.
  it('creates the draft for a survey that has none', async () => {
    const { result } = await mount('empty');
    expect(result.current.config).toBeNull();
    act(() => result.current.replace(restored));
    expect(result.current.config).toEqual(restored);
    expect(result.current.phase).toBe('ready');
    expect(result.current.dirty).toBe(true);
  });

  it('is undoable in one step, back to what was there before', async () => {
    const { result } = await mount('ready');
    act(() => result.current.replace(restored));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.config).toEqual(existing);
  });

  // A restore arriving within the coalescing window used to merge into the edit
  // before it, so one undo reverted both.
  it('never merges into the edit that came just before it', async () => {
    const { result } = await mount('ready');
    act(() =>
      result.current.update((c) => ({
        ...c,
        screens: [{ ...c.screens[0], title: 'הוקלד' }, ...c.screens.slice(1)],
      })),
    );
    act(() => result.current.replace(restored));
    act(() => result.current.undo());
    // One undo lands on the typed edit, not past it.
    expect(result.current.config?.screens[0]).toMatchObject({ title: 'הוקלד' });
  });
});
