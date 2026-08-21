import { describe, expect, it } from 'vitest';
import { LINK_SOURCES, sourceLink } from './link-sources';

const BASE = 'https://example.test/s/main';

describe('LINK_SOURCES', () => {
  it('has exactly one test entry, and it is not a channel', () => {
    const tests = LINK_SOURCES.filter((s) => s.test);
    expect(tests).toHaveLength(1);
    // A test link that also carried ?source= would land in the channel
    // breakdown as if it were real traffic.
    expect(sourceLink(BASE, tests[0])).not.toContain('source=');
  });

  it('keeps every id safe to put in a URL and to group by in the statistics', () => {
    for (const source of LINK_SOURCES) {
      expect(source.id, `${source.id} is not a plain token`).toMatch(/^[a-z0-9-]+$/);
      expect(source.id).toBe(encodeURIComponent(source.id));
      expect(source.label.trim()).not.toBe('');
    }
  });

  it('has no duplicate ids — two buttons writing one value would be unreadable', () => {
    const ids = LINK_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('sourceLink', () => {
  it('tags a channel link with its source', () => {
    const facebook = LINK_SOURCES.find((s) => s.id === 'facebook')!;
    expect(sourceLink(BASE, facebook)).toBe(`${BASE}?source=facebook`);
  });

  // The parameter the whole test-session mechanism keys off: schema.sql treats
  // the presence of url_test in session_start as the definition of a test.
  it('tags the internal link with test=1', () => {
    const test = LINK_SOURCES.find((s) => s.test)!;
    expect(sourceLink(BASE, test)).toBe(`${BASE}?test=1`);
  });

  it('builds on whatever public URL it is given', () => {
    const panel = LINK_SOURCES.find((s) => s.id === 'panel')!;
    expect(sourceLink('https://other.test/s/pilot-2', panel)).toBe(
      'https://other.test/s/pilot-2?source=panel',
    );
  });
});
