import { describe, expect, it } from 'vitest';
import { numberFieldError, numberFieldValue, orderOptions, textLimit } from './input-rules';
import type { Option } from './types';

const opts: Option[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
  { id: 'none', label: 'אף אחד מאלה', exclusive: true },
];

describe('orderOptions', () => {
  it('keeps the author order untouched when there is no shuffle', () => {
    // b_who מציב בכוונה אפשרות בלעדית ("רק אני") ראשונה — אסור להזיז אותה
    const authored: Option[] = [{ id: 'alone', label: 'רק אני', exclusive: true }, ...opts.slice(0, 2)];
    expect(orderOptions(authored, false).map((o) => o.id)).toEqual(['alone', 'a', 'b']);
    expect(orderOptions(authored, undefined).map((o) => o.id)).toEqual(['alone', 'a', 'b']);
  });

  it('never lets a shuffle move an exclusive option out of last place', () => {
    // הבאג המקורי: "הכול ברור לי" נחתה במקום 7 מתוך 10 והוטתה כאפשרות תוכן
    for (let i = 0; i < 200; i++) {
      const ordered = orderOptions(opts, true);
      expect(ordered).toHaveLength(opts.length);
      expect(ordered[ordered.length - 1].id).toBe('none');
    }
  });

  it('keeps several exclusive options together at the end, in author order', () => {
    const two: Option[] = [
      ...opts,
      { id: 'refuse', label: 'מעדיף/ה לא להשיב', exclusive: true },
    ];
    const ordered = orderOptions(two, true).map((o) => o.id);
    expect(ordered.slice(-2)).toEqual(['none', 'refuse']);
  });

  it('actually shuffles the content options', () => {
    const many: Option[] = Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
    const seen = new Set(
      Array.from({ length: 40 }, () => orderOptions(many, true).map((o) => o.id).join(',')),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('does not mutate the input', () => {
    const input = [...opts];
    orderOptions(input, true);
    expect(input.map((o) => o.id)).toEqual(['a', 'b', 'c', 'none']);
  });
});

describe('numberFieldError', () => {
  const age = { min: 16, max: 120, integer: true };

  it('says nothing about an empty field', () => {
    expect(numberFieldError(age, '')).toBeNull();
    expect(numberFieldError(age, '   ')).toBeNull();
  });

  it('explains every way s_age can block the button', () => {
    // הבאג המקורי: "המשך" ב-opacity 0.35 ואפס הודעות
    expect(numberFieldError(age, '15')).toContain('בין 16 ל-120');
    expect(numberFieldError(age, '150')).toContain('בין 16 ל-120');
    expect(numberFieldError(age, '0')).toContain('בין 16 ל-120');
    expect(numberFieldError(age, '-5')).toContain('בין 16 ל-120');
    expect(numberFieldError(age, '40.5')).toContain('שלם');
    expect(numberFieldError(age, 'abc')).toBe('יש להזין מספר');
  });

  it('accepts the valid range, including the bounds', () => {
    for (const raw of ['16', '40', '120']) expect(numberFieldError(age, raw)).toBeNull();
  });

  it('phrases one-sided limits without inventing the other end', () => {
    expect(numberFieldError({ min: 1 }, '0')).toBe('הערך חייב להיות 1 או יותר');
    expect(numberFieldError({ max: 10 }, '11')).toBe('הערך חייב להיות 10 או פחות');
    expect(numberFieldError({}, '-999')).toBeNull();
  });

  it('allows decimals unless the screen asks for integers', () => {
    expect(numberFieldError({ min: 0 }, '40.5')).toBeNull();
    expect(numberFieldError({ min: 0, integer: true }, '40.5')).toContain('שלם');
  });
});

describe('numberFieldValue', () => {
  it('returns a number only when the field is valid', () => {
    expect(numberFieldValue({ min: 16, max: 120, integer: true }, '40')).toBe(40);
    expect(numberFieldValue({ min: 16, max: 120, integer: true }, '15')).toBeNull();
    expect(numberFieldValue({ min: 16, max: 120, integer: true }, '40.5')).toBeNull();
    expect(numberFieldValue({}, '')).toBeNull();
  });
});

describe('textLimit', () => {
  it('defaults to the shared cap and honours a per-screen override', () => {
    expect(textLimit({})).toBe(1000);
    expect(textLimit({ maxLength: 300 })).toBe(300);
  });

  it('ignores a limit that would block all typing and strand the respondent', () => {
    // maxLength={0} על השדה חוסם כל הקלדה, ובמסך לא-אופציונלי "המשך" נשאר
    // חסום לנצח — בדיוק משפחת הבאגים של A7
    for (const bad of [0, -5, 1.5, NaN]) expect(textLimit({ maxLength: bad })).toBe(1000);
  });
});
