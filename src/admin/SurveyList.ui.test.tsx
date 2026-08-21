// @vitest-environment jsdom
//
// The console's home screen, driven through the controls an admin actually uses.
//
// What these tests are really protecting is the data, not the markup. Two of the
// operating guide's rules live entirely in this screen: a link handed to a
// channel must carry ?source=, and a link opened internally must carry ?test=1
// from the first click, because a session is recorded on load and cannot be
// reclassified afterwards. Every assertion below is about the string that ends
// up on the clipboard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurveyList } from './SurveyList';
import type { SurveySummary } from './api';
import type { Surveys } from './useSurveys';

vi.setConfig({ testTimeout: 15_000 });

const ORIGIN = 'http://localhost:3000';

const published: SurveySummary = {
  slug: 'main',
  name: 'שאלון ראשי',
  created_at: '2026-08-01T00:00:00Z',
  created_by: 'seed',
  archived_at: null,
  has_draft: true,
  draft_updated_at: '2026-08-19T18:05:39Z',
  draft_updated_by: 'dvir@first-edea.com',
  versions: 2,
  latest_version: '2026-08-01.1-main',
  latest_published_at: '2026-08-09T05:03:02Z',
};

const unpublished: SurveySummary = {
  ...published,
  slug: 'pilot-2',
  name: 'פיילוט',
  versions: 0,
  latest_version: null,
  latest_published_at: null,
};

function stubSurveys(items: SurveySummary[]): Surveys {
  return {
    phase: 'ready',
    items,
    busy: false,
    error: null,
    dismissError: () => {},
    reload: async () => {},
    create: async () => true,
    rename: async () => true,
    setArchived: async () => true,
    remove: async () => true,
  };
}

let clipboard: string[];

beforeEach(() => {
  clipboard = [];
});

/**
 * A user session with our own clipboard recorder.
 *
 * ⚠ Order matters: userEvent.setup() installs its own clipboard stub, so ours
 * has to be defined after it or every copy lands in user-event's and the
 * assertions see nothing. jsdom exposes navigator.clipboard through a getter
 * only, hence defineProperty rather than assignment.
 */
function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        clipboard.push(text);
        return Promise.resolve();
      },
    },
  });
  return user;
}

afterEach(cleanup);

const renderList = (items: SurveySummary[] = [published]) =>
  render(<SurveyList surveys={stubSurveys(items)} onOpen={() => {}} onStats={() => {}} />);

describe('per-source copy buttons', () => {
  it('offers one button per channel plus the internal test link', async () => {
    renderList();
    for (const label of ['פייסבוק', 'ווטסאפ', 'פאנל', 'בדיקה פנימית']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDefined();
    }
  });

  it('copies a channel link carrying that channel as the source', async () => {
    const user = setupUser();
    renderList();
    await user.click(screen.getByRole('button', { name: /פייסבוק/ }));
    expect(clipboard).toEqual([`${ORIGIN}/s/main?source=facebook`]);
  });

  // The rule that costs data when broken: an internal look must be flagged from
  // the first click, or it is counted as a real respondent forever.
  it('copies the internal link with test=1 and no source', async () => {
    const user = setupUser();
    renderList();
    await user.click(screen.getByRole('button', { name: /בדיקה פנימית/ }));
    expect(clipboard).toEqual([`${ORIGIN}/s/main?test=1`]);
    expect(clipboard[0]).not.toContain('source=');
  });

  it('confirms on screen that the link was copied', async () => {
    const user = setupUser();
    renderList();
    const button = screen.getByRole('button', { name: /ווטסאפ/ });
    await user.click(button);
    expect(await screen.findByRole('button', { name: /ווטסאפ ✓/ })).toBeDefined();
  });

  it('sets the test link apart from the real channels', () => {
    renderList();
    const test = screen.getByRole('button', { name: /בדיקה פנימית/ });
    const facebook = screen.getByRole('button', { name: /פייסבוק/ });
    expect(test.className).toContain('copy-test');
    expect(facebook.className).not.toContain('copy-test');
    // The tooltip has to say what the flag does — the visual cue alone does not
    // explain why sending it to a respondent would be wrong.
    expect(test.getAttribute('title')).toMatch(/לא ייספר/);
  });

  it('offers no copy buttons before the first version is published', () => {
    renderList([unpublished]);
    expect(screen.queryByRole('button', { name: /פייסבוק/ })).toBeNull();
    expect(screen.getByText(/יתחיל לעבוד אחרי פרסום הגרסה הראשונה/)).toBeDefined();
  });

  // An archived survey has published versions, so it used to render a full row
  // of live-looking copy buttons — for a link that answers "השאלון נסגר".
  // Spending a channel on that is exactly what these buttons exist to prevent.
  it('offers no copy buttons for an archived survey, and says why', async () => {
    const user = userEvent.setup();
    renderList([{ ...published, archived_at: '2026-08-15T00:00:00Z' }]);
    // Archived surveys are collapsed behind their own toggle.
    await user.click(screen.getByRole('button', { name: /ארכיון \(1\)/ }));
    for (const label of ['פייסבוק', 'ווטסאפ', 'פאנל', 'בדיקה פנימית']) {
      expect(screen.queryByRole('button', { name: new RegExp(label) })).toBeNull();
    }
    expect(screen.getByText(/בארכיון: הקישור מציג/)).toBeDefined();
    // The link itself stays readable — it is where past respondents went.
    expect(screen.getByRole('link', { name: `${ORIGIN}/s/main` })).toBeDefined();
  });

  // The component's own comment promises this degrades quietly: the link is on
  // screen and can be selected by hand.
  it('does not break or claim success when the clipboard refuses', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
    renderList();
    const button = screen.getByRole('button', { name: /פייסבוק/ });
    await user.click(button);
    expect(button.textContent).toContain('פייסבוק');
    expect(button.textContent).not.toContain('✓');
  });
});

describe('the public link', () => {
  it('points every survey at /s/<slug>, the default survey included', () => {
    renderList();
    const link = screen.getByRole('link', { name: `${ORIGIN}/s/main` });
    expect(link.getAttribute('href')).toBe(`${ORIGIN}/s/main`);
  });

  it('shows the live version and the draft timestamp so the two are never confused', () => {
    renderList();
    const card = screen.getByRole('article');
    expect(within(card).getByText(/2026-08-01.1-main/)).toBeDefined();
    expect(within(card).getByText(/הטיוטה עודכנה לאחרונה/)).toBeDefined();
  });
});
