// nextCode is what spares the admin from inventing analysis codes: the console
// offers the next free one in the series and most admins never touch it. The
// outcome that matters is a suggestion that collides with a code already in use —
// two marks sharing a code cannot be told apart in the data file, and nothing in
// the console would show it.

import { describe, expect, it } from 'vitest';
import { nextCode } from './DefineForm';

describe('nextCode', () => {
  it('starts a fresh series at 1', () => {
    expect(nextCode('mark', [])).toBe('mark1');
  });

  it('skips a code that is already taken', () => {
    expect(nextCode('mark', ['mark1'])).toBe('mark2');
  });

  it('fills a gap left by a deleted code instead of climbing past it', () => {
    expect(nextCode('mark', ['mark1', 'mark3'])).toBe('mark2');
  });

  it('compares whole codes — a longer one that merely starts the same does not block it', () => {
    expect(nextCode('mark', ['mark10', 'markx1'])).toBe('mark1');
  });

  it('keeps counting past a run of taken codes', () => {
    expect(nextCode('v', ['v1', 'v2', 'v3', 'v4', 'v5'])).toBe('v6');
  });
});
