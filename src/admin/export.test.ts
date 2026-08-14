// בדיקות ההיפוך והכתיבה של הייצוא (export.ts): טבלה רחבה נכונה לכל סוגי
// השאלות, איחוד בין גרסאות, והיגיינת CSV — BOM, ציטוט עברית, וחסימת נוסחאות.

import { describe, expect, it } from 'vitest';
import type { SurveyConfig } from '../engine/types';
import {
  buildExportTable,
  toCsv,
  type ExportAnswer,
  type ExportSession,
  type ExportVersion,
} from './export';

const config = (over: Partial<SurveyConfig> = {}): SurveyConfig => ({
  version: 'v-test',
  screens: [
    { type: 'info', id: 'welcome', title: 'ברוכים הבאים', body: '' },
    {
      type: 'consent',
      id: 'consent',
      title: 'הסכמה',
      body: '',
      agreeLabel: 'מסכים/ה',
      declineLabel: 'לא',
    },
    {
      type: 'single',
      id: 'q_status',
      prompt: 'מה מצבכם?',
      options: [
        { id: 'own', label: 'בעלות על דירה' },
        { id: 'rent', label: 'שכירות' },
      ],
    },
    {
      type: 'multi',
      id: 'q_sources',
      prompt: 'מאיפה מידע?',
      options: [
        { id: 'bank', label: 'הבנק' },
        { id: 'friends', label: 'חברים' },
      ],
    },
    {
      type: 'matrix',
      id: 'q_worry',
      prompt: 'כמה מדאיג?',
      items: [
        { id: 'rate', label: 'הריבית' },
        { id: 'bureaucracy', label: 'הבירוקרטיה' },
      ],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'כלל לא',
      maxLabel: 'מאוד',
      naLabel: 'לא רלוונטי',
    },
    { type: 'number', id: 'q_age', prompt: 'גיל' },
    { type: 'text', id: 'q_open', prompt: 'ספרו לנו', optional: true },
    { type: 'end', id: 'done', variant: 'complete', title: 'תודה', body: '' },
  ],
  varMeta: { segment: { label: 'פרסונה', values: { renter: 'שוכר/ת' } } },
  ...over,
});

const session = (over: Partial<ExportSession> = {}): ExportSession => ({
  session_id: 's1',
  survey_version: 'v1',
  started_at: '2026-08-14T09:00:00Z',
  outcome: 'complete',
  answered_any: true,
  is_test: false,
  vars: { segment: 'renter', url_source: 'whatsapp' },
  ...over,
});

const versions: ExportVersion[] = [{ version: 'v1', config: config() }];

describe('buildExportTable', () => {
  it('הופך סשן לשורה אחת: מטא, משתנים, וכל סוגי התשובות בעמודות הנכונות', () => {
    const answers: ExportAnswer[] = [
      { session_id: 's1', screen_id: 'consent', value: 'agreed' },
      { session_id: 's1', screen_id: 'q_status', value: 'rent' },
      { session_id: 's1', screen_id: 'q_sources', value: ['bank', 'friends'] },
      { session_id: 's1', screen_id: 'q_worry', value: { rate: 5, bureaucracy: 'na' } },
      { session_id: 's1', screen_id: 'q_age', value: 42 },
      { session_id: 's1', screen_id: 'q_open', value: 'טקסט חופשי, עם פסיק' },
    ];
    const rows = buildExportTable([session()], answers, versions);
    const [ids, labels, row] = rows;
    const cell = (id: string) => row[ids.indexOf(id)];

    // מסכי info/end אינם עמודות; למטריצה עמודה לכל פריט
    expect(ids).toEqual([
      'session_id',
      'survey_version',
      'started_at',
      'outcome',
      'is_test',
      'segment',
      'url_source',
      'consent',
      'q_status',
      'q_sources',
      'q_worry.rate',
      'q_worry.bureaucracy',
      'q_age',
      'q_open',
    ]);
    expect(labels[ids.indexOf('segment')]).toBe('פרסונה');
    expect(labels[ids.indexOf('q_worry.rate')]).toBe('כמה מדאיג? · הריבית');

    expect(cell('outcome')).toBe('complete');
    expect(cell('is_test')).toBe(0);
    // ערכי משתנים נשארים קודים (שפת האנליזה) — התווית רק בכותרת
    expect(cell('segment')).toBe('renter');
    expect(cell('q_status')).toBe('שכירות');
    expect(cell('q_sources')).toBe('הבנק; חברים');
    expect(cell('q_worry.rate')).toBe(5);
    expect(cell('q_worry.bureaucracy')).toBe('na');
    expect(cell('q_age')).toBe(42);
    expect(cell('q_open')).toBe('טקסט חופשי, עם פסיק');
  });

  it('נטישה נפרסת כמו באריחי הסקירה, ושאלה בלי תשובה או עם דילוג — תא ריק', () => {
    const sessions = [
      session({ session_id: 'mid', outcome: null, answered_any: true }),
      session({ session_id: 'bounce', outcome: null, answered_any: false, vars: null }),
    ];
    const answers: ExportAnswer[] = [{ session_id: 'mid', screen_id: 'q_open', value: null }];
    const rows = buildExportTable(sessions, answers, versions);
    const ids = rows[0];
    expect(rows[2][ids.indexOf('outcome')]).toBe('abandoned_mid');
    expect(rows[3][ids.indexOf('outcome')]).toBe('abandoned_bounce');
    expect(rows[2][ids.indexOf('q_open')]).toBe('');
    expect(rows[2][ids.indexOf('q_status')]).toBe('');
    expect(rows[3][ids.indexOf('segment')]).toBe('');
  });

  it('כל הגרסאות: הקונפיג החדש קובע סדר, והישן תורם מסכים ואפשרויות שפרשו', () => {
    const oldConfig = config({
      screens: [
        ...config().screens.filter((s) => s.id !== 'q_age'),
        { type: 'single', id: 'q_retired', prompt: 'שאלה שהוסרה', options: [{ id: 'x', label: 'איקס' }] },
      ],
    });
    const two: ExportVersion[] = [
      { version: 'v2', config: config() },
      { version: 'v1', config: oldConfig },
    ];
    const answers: ExportAnswer[] = [
      { session_id: 's1', screen_id: 'q_retired', value: 'x' },
      // פריט מטריצה שקיים רק בנתונים — מקבל עמודה עם המזהה הגולמי
      { session_id: 's1', screen_id: 'q_worry', value: { ghost: 3 } },
    ];
    const rows = buildExportTable([session()], answers, two);
    const ids = rows[0];
    // מסך שקיים רק בגרסה ישנה מופיע אחרי מסכי הקונפיג החדש
    expect(ids.indexOf('q_retired')).toBeGreaterThan(ids.indexOf('q_open'));
    expect(rows[2][ids.indexOf('q_retired')]).toBe('איקס');
    expect(rows[2][ids.indexOf('q_worry.ghost')]).toBe(3);
  });

  it('מסך שמופיע בנתונים אך בשום קונפיג נספח בסוף עם ערכו הגולמי', () => {
    const answers: ExportAnswer[] = [{ session_id: 's1', screen_id: 'q_ghost', value: 'raw' }];
    const rows = buildExportTable([session()], answers, versions);
    const ids = rows[0];
    expect(ids[ids.length - 1]).toBe('q_ghost');
    expect(rows[2][ids.indexOf('q_ghost')]).toBe('raw');
  });
});

describe('toCsv', () => {
  it('BOM בראש הקובץ, CRLF בין שורות, ועברית עם פסיק עטופה בציטוט', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['שלום, עולם', 'רגיל'],
    ]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toBe('\ufeffa,b\r\n"שלום, עולם",רגיל\r\n');
  });

  it('מרכאות ושורות חדשות בטקסט של משיבים נשמרות כדין', () => {
    const csv = toCsv([['אמר "כן"\nוגם לא']]);
    expect(csv).toBe('\ufeff"אמר ""כן""\nוגם לא"\r\n');
  });

  it('תו-נוסחה בתחילת תא נחסם בגרש; מספר שלילי אמיתי אינו נפגע', () => {
    const csv = toCsv([['=IMPORTXML("x")', '+972', '@here', '-5', -5, 'טקסט רגיל']]);
    expect(csv).toContain(`'=IMPORTXML`);
    expect(csv).toContain(`'+972`);
    expect(csv).toContain(`'@here`);
    // ‎-5‎ כמחרוזת מספרית וכמספר — שניהם עוברים כמות שהם
    expect(csv).toContain('-5,-5,');
    expect(csv).not.toContain(`'-5`);
  });
});
