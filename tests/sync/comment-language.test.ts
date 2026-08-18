// The repo's sharpest convention, from README: every comment in the code is in
// English, and everything a user reads stays Hebrew. A comment is translated, a
// string is not.
//
// ENG-23 translated the lot in one pass, and one comment still slipped through
// unnoticed for days — which is the whole argument for a guard. A convention
// enforced only by review is a convention that decays one merge at a time.
//
// The test is deliberately narrow: an English comment that *quotes* a Hebrew UI
// string is correct and common ("the copy reads כבר נאספו מספיק"), so only a
// comment whose own prose is Hebrew counts as a breach.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const HEBREW = /[א-ת]/;
const LATIN = /[A-Za-z]/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The prose of a comment line, or null when the line carries no comment. */
function commentBody(line: string): string | null {
  const match = line.match(/^\s*(?:\/\/|\*)\s?(.*)$/) ?? line.match(/\/\/\s?(.*)$/);
  return match ? match[1] : null;
}

describe('code comments are written in English', () => {
  it('no comment in the source is written in Hebrew', () => {
    const offenders: string[] = [];
    for (const file of [...sources('src'), ...sources('netlify'), ...sources('tests')]) {
      readFileSync(new URL(file, root), 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const body = commentBody(line);
          if (!body || !HEBREW.test(body)) return;
          // More Hebrew than Latin = the comment itself is Hebrew, rather than an
          // English comment quoting a Hebrew label
          const hebrew = (body.match(/[א-ת]/g) ?? []).length;
          const latin = (body.match(LATIN) ? body.match(/[A-Za-z]/g)! : []).length;
          if (hebrew > latin) offenders.push(`${file}:${i + 1} — ${body.trim().slice(0, 60)}`);
        });
    }
    expect(offenders, `translate these comments to English:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the rule the test enforces is the one the README states', () => {
    // If the README ever changes its mind, this test should be the thing that
    // notices rather than a reviewer two months later.
    const readme = readFileSync(new URL('README.md', root), 'utf8');
    expect(readme).toContain('כל ההערות בקוד באנגלית');
  });
});
