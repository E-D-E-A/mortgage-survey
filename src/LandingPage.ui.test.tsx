// @vitest-environment jsdom
//
// The landing page is defined by what it must NOT do.
//
// Everything that is not /s/<slug> renders this component, so if it ever
// mounted the questionnaire — directly, or by pulling in something that loads a
// config — every stray visit would go back to recording a respondent session
// that can never be reclassified as a test. That is the bug this branch exists
// to remove, and a render test alone would not catch its return: someone could
// add an import that fetches without ever rendering a screen.
//
// So there are two assertions here: what it renders, and what it is allowed to
// depend on.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import LandingPage from './LandingPage';

afterEach(cleanup);

// Resolved from the project root, not from import.meta.url: under jsdom that
// is an http URL and readFileSync will not take it.
const source = readFileSync(resolve(process.cwd(), 'src/LandingPage.tsx'), 'utf8');

describe('what the landing page depends on', () => {
  it('imports nothing that could mount or load a survey', () => {
    for (const forbidden of ['./App', './AppShell', './data/config', './data/quota', './data/events']) {
      expect(source, `LandingPage imports ${forbidden}`).not.toContain(`from '${forbidden}'`);
    }
  });

  it('does not fetch', () => {
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});

describe('what the landing page renders', () => {
  it('records nothing — no network call on mount', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<LandingPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('explains that a survey is reached through its own link', () => {
    render(<LandingPage />);
    expect(screen.getByText(/כל שאלון נפתח\s+מקישור ייעודי/)).toBeDefined();
  });

  it('shows no question, no answer control and no call to action into a survey', () => {
    render(<LandingPage />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
