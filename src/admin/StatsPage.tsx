// מסך הסטטיסטיקות של שאלון (/admin/<slug>/stats) — קריאה בלבד, בלי שום
// מנגנון טיוטה/שמירה. הנתונים נטענים טריים בכל ביקור ובכל שינוי פקד
// (ה-endpoint מסומן no-store): צפייה חיה בשטח חשובה מקאש.
// סשני בדיקה (?test=1) מוחרגים כברירת מחדל; המתג מחזיר אותם לצורך דיבוג.

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  ForbiddenError,
  getOpenAnswers,
  getStats,
  UnauthorizedError,
  type OpenAnswersPage,
  type StatsBundle,
} from './api';
import {
  binNumbers,
  binNumbersByDim,
  chosenConfig,
  dimensionLegend,
  dimensionOptions,
  formatCount,
  formatDuration,
  formatPercent,
  orderFunnel,
  overviewTiles,
  outcomeLabel,
  questionCards,
  textScreens,
  UNKNOWN_DIM_KEY,
  type DimensionLegend,
  type QuestionCardModel,
  type SplitSpec,
} from './stats';
import { LogoutIcon } from './Icons';
import { supabase } from './supabaseClient';

interface Props {
  slug: string;
  /** שם התצוגה מרשימת השאלונים — עד שה-bundle מגיע עם השם מהשרת */
  name: string;
  email: string;
  onBack: () => void;
  onOpenEditor: () => void;
  onAuthError: () => void;
}

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; status?: number }
  | { phase: 'ready'; bundle: StatsBundle };

export function StatsPage({ slug, name, email, onBack, onOpenEditor, onAuthError }: Props) {
  const [version, setVersion] = useState<string>('all');
  const [includeTest, setIncludeTest] = useState(false);
  const [by, setBy] = useState('');
  const [tab, setTab] = useState<'stats' | 'answers'>('stats');
  const [load, setLoad] = useState<Load>({ phase: 'loading' });

  const fetchNow = useCallback(async () => {
    setLoad({ phase: 'loading' });
    try {
      const bundle = await getStats(slug, { version, includeTest, by: by || undefined });
      setLoad({ phase: 'ready', bundle });
    } catch (e) {
      if (e instanceof UnauthorizedError || e instanceof ForbiddenError) {
        onAuthError();
        return;
      }
      setLoad({ phase: 'error', status: e instanceof ApiError ? e.status : undefined });
    }
  }, [slug, version, includeTest, by, onAuthError]);

  useEffect(() => {
    void fetchNow();
  }, [fetchNow]);

  const bundle = load.phase === 'ready' ? load.bundle : null;

  return (
    <div className="admin-app">
      <header className="topbar">
        <div className="topbar-title">
          <button className="a-btn ghost small" onClick={onBack} title="חזרה לרשימת השאלונים">
            → כל השאלונים
          </button>
          <h1>סטטיסטיקות · {bundle?.name ?? name}</h1>
        </div>
        <div className="topbar-actions">
          <button className="a-btn ghost small" onClick={onOpenEditor}>
            פתיחת העורך
          </button>
          <span className="topbar-user" title={email}>
            {email}
          </span>
          <button
            className="a-icon-btn"
            onClick={() => void supabase.auth.signOut()}
            aria-label="יציאה מהחשבון"
            title="יציאה מהחשבון"
          >
            <LogoutIcon />
          </button>
        </div>
      </header>

      <div className="admin-scroll">
        <div className="stats-body">
          <div className="stats-controls">
            <label className="stats-control">
              גרסה
              <select
                className="a-input"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={!bundle || bundle.versions.length === 0}
              >
                <option value="all">כל הגרסאות</option>
                {bundle?.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="stats-control">
              פילוח לפי
              <select
                className="a-input"
                value={by}
                onChange={(e) => setBy(e.target.value)}
                disabled={!bundle || bundle.versions.length === 0}
              >
                <option value="">בלי פילוח</option>
                {bundle &&
                  dimensionOptions(bundle.versions, version).map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="stats-control stats-toggle" title="סשנים שנפתחו מקישור עם ?test=1">
              <input
                type="checkbox"
                checked={includeTest}
                onChange={(e) => setIncludeTest(e.target.checked)}
              />
              כולל סשני בדיקה
            </label>
            <button className="a-btn ghost small" onClick={() => void fetchNow()}>
              רענון
            </button>
          </div>

          <div className="stats-tabs" role="tablist" aria-label="תצוגות">
            <button
              role="tab"
              aria-selected={tab === 'stats'}
              className={`stats-tab${tab === 'stats' ? ' active' : ''}`}
              onClick={() => setTab('stats')}
            >
              סטטיסטיקות
            </button>
            <button
              role="tab"
              aria-selected={tab === 'answers'}
              className={`stats-tab${tab === 'answers' ? ' active' : ''}`}
              onClick={() => setTab('answers')}
            >
              תשובות פתוחות
            </button>
          </div>

          {load.phase === 'loading' && <p className="stats-empty">טוענים נתונים…</p>}

          {load.phase === 'error' && (
            <p className="stats-empty">
              טעינת הנתונים נכשלה{load.status ? ` (${load.status})` : ''} — אפשר לנסות לרענן.
            </p>
          )}

          {bundle && bundle.versions.length === 0 && (
            <p className="stats-empty">
              טרם פורסמה גרסה לשאלון הזה, ולכן אין עדיין נתונים. הנתונים יתחילו להיאסף עם
              הפרסום הראשון.
            </p>
          )}

          {bundle && bundle.versions.length > 0 && tab === 'stats' && (
            <>
              <OverviewTiles bundle={bundle} includeTest={includeTest} />
              {bundle.overview.total_sessions > 0 && (
                <>
                  <FunnelSection bundle={bundle} version={version} />
                  <DistributionsSection bundle={bundle} version={version} by={by} />
                </>
              )}
            </>
          )}

          {bundle && bundle.versions.length > 0 && tab === 'answers' && (
            <OpenAnswersTab
              slug={slug}
              bundle={bundle}
              version={version}
              includeTest={includeTest}
              onAuthError={onAuthError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelSection({ bundle, version }: { bundle: StatsBundle; version: string }) {
  const rows = orderFunnel(bundle.funnel, bundle.versions, version);
  if (rows.length === 0) return null;
  return (
    <section aria-label="משפך פר-מסך">
      <h2 className="stats-section-title">משפך — איפה נשארים ואיפה נוטשים</h2>
      <div className="funnel-table-wrap">
        <table className="funnel-table">
          <thead>
            <tr>
              <th>מסך</th>
              <th>צפו</th>
              <th>ענו</th>
              <th>נטשו כאן</th>
              <th title="חציון זמן ניסיון ראשון בלבד — מענה חוזר אחרי חזרה אחורה לא נספר">
                זמן חציוני
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.screenId} className={row.retired ? 'funnel-retired' : undefined}>
                <td className="funnel-label">
                  {row.retired ? (
                    <>
                      <code dir="ltr">{row.screenId}</code>
                      <span className="a-hint"> · לא קיים בגרסה הנוכחית</span>
                    </>
                  ) : (
                    row.label
                  )}
                </td>
                <td>{formatCount(row.viewed)}</td>
                <td>{formatCount(row.answered)}</td>
                <td>{row.droppedHere > 0 ? formatCount(row.droppedHere) : '—'}</td>
                <td>{formatDuration(row.medianMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── לשונית התשובות הפתוחות (ENG-16) ────────────────────────────────────────
// קריאה בלבד, כלשונן: שום קידוד, שום ניתוח תוכן — רק סינון, אורכים ודפדוף.

const PAGE_SIZE = 50;

function OpenAnswersTab({
  slug,
  bundle,
  version,
  includeTest,
  onAuthError,
}: {
  slug: string;
  bundle: StatsBundle;
  version: string;
  includeTest: boolean;
  onAuthError: () => void;
}) {
  const questions = textScreens(bundle.versions, version);
  const [screen, setScreen] = useState('all');
  const [segment, setSegment] = useState('all');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<OpenAnswersPage | null>(null);
  const [failed, setFailed] = useState(false);

  const screens = screen === 'all' ? questions.map((q) => q.id) : [screen];
  const screensKey = screens.join(',');

  useEffect(() => {
    setOffset(0);
  }, [screensKey, segment, version, includeTest]);

  useEffect(() => {
    if (screens.length === 0) return;
    let stale = false;
    setFailed(false);
    getOpenAnswers(slug, {
      screens,
      version,
      includeTest,
      segment: segment === 'all' ? undefined : segment,
      limit: PAGE_SIZE,
      offset,
    })
      .then((data) => {
        if (!stale) setPage(data);
      })
      .catch((e) => {
        if (e instanceof UnauthorizedError || e instanceof ForbiddenError) onAuthError();
        else if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
    // התלות היא screensKey (מחרוזת יציבה) — מערך ה-screens נגזר ממנה בכל רינדור
  }, [slug, screensKey, segment, version, includeTest, offset, onAuthError]);

  if (questions.length === 0) {
    return <p className="stats-empty">בשאלון הזה אין שאלות פתוחות (שאלות טקסט).</p>;
  }
  if (failed) {
    return <p className="stats-empty">טעינת התשובות נכשלה — אפשר לנסות לרענן.</p>;
  }

  const config = chosenConfig(bundle.versions, version);
  const segmentValues = config?.varMeta?.segment?.values ?? {};
  const questionLabel = new Map(questions.map((q) => [q.id, q.label]));

  return (
    <section aria-label="תשובות פתוחות">
      <div className="stats-controls">
        <label className="stats-control">
          שאלה
          <select className="a-input" value={screen} onChange={(e) => setScreen(e.target.value)}>
            <option value="all">כל השאלות הפתוחות</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <label className="stats-control">
          מסלול המשיב
          <select className="a-input" value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="all">הכול</option>
            {Object.entries(segmentValues).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="__unknown__">לא ידוע</option>
          </select>
        </label>
      </div>

      {page && (
        <>
          <div className="oa-stats">
            {page.stats.map((s) => (
              <div key={s.screen_id} className="oa-stat-row">
                <span className="oa-stat-q" title={questionLabel.get(s.screen_id) ?? s.screen_id}>
                  {questionLabel.get(s.screen_id) ?? s.screen_id}
                </span>
                <span className="a-hint">
                  ענו {formatCount(s.answered)} · דילגו {formatCount(s.skipped)} · נטשו{' '}
                  {formatCount(s.abandoned)}
                  {s.len_median !== null && (
                    <>
                      {' '}
                      · אורך: {formatCount(s.len_min ?? 0)}–{formatCount(s.len_max ?? 0)} תווים
                      (חציון {formatCount(s.len_median)}, עשירון עליון {formatCount(s.len_p90 ?? 0)})
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>

          {page.total === 0 ? (
            <p className="stats-empty">אין תשובות טקסט בטווח הסינון הנוכחי.</p>
          ) : (
            <>
              <ul className="oa-list">
                {page.rows.map((row, i) => (
                  <li key={`${row.created_at}-${i}`} className="oa-row">
                    <p className="oa-text">{row.value}</p>
                    <p className="oa-meta a-hint">
                      {screen === 'all' && (
                        <>
                          {questionLabel.get(row.screen_id) ?? row.screen_id}
                          {' · '}
                        </>
                      )}
                      {new Date(row.created_at).toLocaleDateString('he-IL')}
                      {' · '}
                      <bdi dir="ltr">{row.survey_version}</bdi>
                      {' · '}
                      {row.segment ? (segmentValues[row.segment] ?? row.segment) : 'לא ידוע'}
                      {' · '}
                      {outcomeLabel(row.outcome)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="oa-pager">
                <button
                  className="a-btn ghost small"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  → הקודם
                </button>
                <span className="a-hint">
                  {formatCount(offset + 1)}–{formatCount(Math.min(offset + PAGE_SIZE, page.total))}{' '}
                  מתוך {formatCount(page.total)}
                </span>
                <button
                  className="a-btn ghost small"
                  disabled={offset + PAGE_SIZE >= page.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  הבא ←
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function DistributionsSection({
  bundle,
  version,
  by,
}: {
  bundle: StatsBundle;
  version: string;
  by: string;
}) {
  // הפילוח פעיל רק אם השרת באמת החזיר את המימד הזה (bundle.by) — אחרת
  // הנתונים שביד הם ללא פילוח והמקרא היה משקר
  const active = by !== '' && bundle.by === by;
  const legend: DimensionLegend | null = active
    ? dimensionLegend(bundle.distributions, by, chosenConfig(bundle.versions, version))
    : null;
  const split: SplitSpec | undefined =
    legend && legend.mode === 'ok' ? { legend, bases: bundle.bases } : undefined;
  const cards = questionCards(bundle.distributions, bundle.funnel, bundle.versions, version, split);
  if (cards.length === 0) return null;
  return (
    <section aria-label="התפלגויות תשובות">
      <h2 className="stats-section-title">מה ענו — שאלה אחר שאלה</h2>
      {legend?.mode === 'refused' && (
        <p className="a-hint">
          למימד הזה יש {formatCount(legend.distinct)} ערכים שונים — יותר מדי בשביל תרשים קריא
          (המקסימום 12). ההתפלגויות מוצגות בלי פילוח.
        </p>
      )}
      {split && (
        <div className="dim-legend" role="list" aria-label="מקרא הפילוח">
          {split.legend.values.map((v) => (
            <span key={v.key ?? '∅'} className="dim-chip" role="listitem">
              <span className="dim-swatch" style={{ background: v.color }} />
              {v.label}
            </span>
          ))}
        </div>
      )}
      <div className="q-cards">
        {cards.map((card) => (
          <QuestionCard key={card.screenId} card={card} split={split} />
        ))}
      </div>
    </section>
  );
}

function QuestionCard({ card, split }: { card: QuestionCardModel; split?: SplitSpec }) {
  return (
    <article className="q-card">
      <header className="q-card-head">
        <h3>{card.label}</h3>
        <span className="a-hint">
          {formatCount(card.base)} ענו
          {card.spansVersions && (
            <span
              className="chip q-chip"
              title="נוסח או אפשרויות שונים בין הגרסאות המשולבות — להשוואה מדויקת יש לבחור גרסה"
            >
              מתפרס על {card.spansVersions} גרסאות
            </span>
          )}
        </span>
      </header>
      {card.base === 0 ? (
        <p className="a-hint">אף אחד עוד לא ענה על השאלה הזאת.</p>
      ) : card.bars ? (
        <ChoiceBars card={card} split={split} />
      ) : card.matrix ? (
        <MatrixChart matrix={card.matrix} split={split} />
      ) : card.numberValues ? (
        <NumberHistogram card={card} split={split} />
      ) : null}
      {card.type === 'multi' && card.base > 0 && (
        <p className="a-hint q-note">אחוז מהעונים; אפשר לבחור כמה אפשרויות, ולכן הסכום עשוי לעבור 100%.</p>
      )}
    </article>
  );
}

/**
 * עמודות אופקיות ב-RTL: הבסיס בצד ימין (inline-start), הקצה המעוגל בקצה
 * הנתון בלבד; הערך יושב בקצה כל עמודה — טקסט בטוקן טקסט, לא בצבע הסדרה.
 */
function ChoiceBars({ card, split }: { card: QuestionCardModel; split?: SplitSpec }) {
  if (split) return <GroupedChoiceBars card={card} split={split} />;
  const max = Math.max(...card.bars!.map((b) => b.ratio ?? 0), 0.0001);
  return (
    <div className="q-bars" role="img" aria-label={`התפלגות: ${card.label}`}>
      {card.bars!.map((bar) => (
        <div key={bar.id} className="q-bar-row">
          <span className={`q-bar-label${bar.retiredOption ? ' retired' : ''}`} title={bar.label}>
            {bar.retiredOption ? <code dir="ltr">{bar.id}</code> : bar.label}
          </span>
          <span className="q-bar-track">
            <span
              className="q-bar-fill"
              style={{ inlineSize: `${((bar.ratio ?? 0) / max) * 100}%` }}
            />
          </span>
          <span className="q-bar-value">
            {formatCount(bar.count)}
            {bar.ratio !== null && <span className="q-bar-pct"> · {formatPercent(bar.ratio)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * מצב פילוח: לכל אפשרות תת-עמודה לכל ערך מימד, בסדר ובצבעי המקרא. האחוז של
 * כל קבוצה מחושב מתוך העונים באותה קבוצה (stats_bases) — לא מתוך כלל העונים.
 */
function GroupedChoiceBars({ card, split }: { card: QuestionCardModel; split: SplitSpec }) {
  const max = Math.max(
    ...card.bars!.flatMap((b) => (b.groups ?? []).map((g) => g.ratio ?? 0)),
    0.0001,
  );
  return (
    <div className="q-bars grouped" role="img" aria-label={`התפלגות מפולחת: ${card.label}`}>
      {card.bars!.map((bar) => (
        <div key={bar.id} className="q-group">
          <span className={`q-bar-label${bar.retiredOption ? ' retired' : ''}`} title={bar.label}>
            {bar.retiredOption ? <code dir="ltr">{bar.id}</code> : bar.label}
          </span>
          {(bar.groups ?? []).map((g, i) => (
            <div key={g.key ?? '∅'} className="q-bar-row slim">
              <span className="q-bar-track slim">
                <span
                  className="q-bar-fill slim"
                  style={{
                    inlineSize: `${((g.ratio ?? 0) / max) * 100}%`,
                    background: split.legend.values[i].color,
                  }}
                  title={`${split.legend.values[i].label}: ${formatCount(g.count)}`}
                />
              </span>
              <span className="q-bar-value">
                {formatCount(g.count)}
                {g.ratio !== null && (
                  <span className="q-bar-pct"> · {formatPercent(g.ratio)}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * פס ההדגשה של סולם המטריצה: חמישה עוגנים בגוון המותג, בהיר→כהה, שאומתו עם
 * ה-validator של מיומנות ה-dataviz במצב ordinal (מונוטוני, מרווחי L, ≥2:1).
 * סולם בגודל אחר נדגם מאותו פס באינטרפולציה — אותו דפוס מאומת.
 */
const SCALE_RAMP = ['#58bfa9', '#2aa78e', '#008f75', '#00705c', '#005243'];
const NA_COLOR = '#d7dadf';

function scaleColor(idx: number, steps: number): string {
  if (steps <= 1) return SCALE_RAMP[SCALE_RAMP.length - 1];
  const pos = (idx / (steps - 1)) * (SCALE_RAMP.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return SCALE_RAMP[lo];
  const f = pos - lo;
  const ch = (a: number, b: number) => Math.round(a + (b - a) * f);
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = hex(SCALE_RAMP[lo]);
  const [r2, g2, b2] = hex(SCALE_RAMP[hi]);
  return `#${[ch(r1, r2), ch(g1, g2), ch(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function MatrixChart({
  matrix,
  split,
}: {
  matrix: NonNullable<QuestionCardModel['matrix']>;
  split?: SplitSpec;
}) {
  const steps = matrix.scaleMax - matrix.scaleMin + 1;
  const keys = Array.from({ length: steps }, (_, i) => String(matrix.scaleMin + i));

  const track = (counts: Record<string, number>, na: number) => {
    const total = Object.values(counts).reduce((s, c) => s + c, 0) + na;
    if (total === 0) return <span className="a-hint">—</span>;
    return (
      <>
        {keys.map((k, i) => {
          const count = counts[k] ?? 0;
          if (count === 0) return null;
          return (
            <span
              key={k}
              className="mx-seg"
              style={{ inlineSize: `${(count / total) * 100}%`, background: scaleColor(i, steps) }}
              title={`${k}: ${formatCount(count)}`}
            />
          );
        })}
        {na > 0 && (
          <span
            className="mx-seg"
            style={{ inlineSize: `${(na / total) * 100}%`, background: NA_COLOR }}
            title={`${matrix.naLabel ?? 'na'}: ${formatCount(na)}`}
          />
        )}
      </>
    );
  };

  const meanCell = (mean: number | null) =>
    mean !== null ? (
      <>
        ממוצע <span className="q-bar-pct">{formatMean(mean)}</span>
      </>
    ) : (
      '—'
    );

  return (
    <div className="mx-chart">
      <div className="mx-legend" aria-hidden="true">
        <span className="mx-legend-label">{matrix.minLabel}</span>
        {keys.map((k, i) => (
          <span key={k} className="mx-swatch" style={{ background: scaleColor(i, steps) }} title={k} />
        ))}
        <span className="mx-legend-label">{matrix.maxLabel}</span>
        {matrix.naLabel && (
          <>
            <span className="mx-swatch" style={{ background: NA_COLOR }} />
            <span className="mx-legend-label">{matrix.naLabel}</span>
          </>
        )}
      </div>
      {matrix.items.map((item) =>
        split && item.variants ? (
          <div key={item.id} className="mx-item-block">
            <span className={`q-bar-label${item.retiredItem ? ' retired' : ''}`} title={item.label}>
              {item.retiredItem ? <code dir="ltr">{item.id}</code> : item.label}
            </span>
            {item.variants.map((variant, i) => (
              <div key={variant.key ?? '∅'} className="mx-row slim">
                <span className="mx-dim-label" title={split.legend.values[i].label}>
                  <span className="dim-swatch" style={{ background: split.legend.values[i].color }} />
                  {split.legend.values[i].label}
                </span>
                <span className="mx-track slim">{track(variant.counts, variant.na)}</span>
                <span className="q-bar-value">{meanCell(variant.mean)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div key={item.id} className="mx-row">
            <span className={`q-bar-label${item.retiredItem ? ' retired' : ''}`} title={item.label}>
              {item.retiredItem ? <code dir="ltr">{item.id}</code> : item.label}
            </span>
            <span className="mx-track">{track(item.counts, item.na)}</span>
            <span className="q-bar-value">{meanCell(item.mean)}</span>
          </div>
        ),
      )}
    </div>
  );
}

const formatMean = (mean: number): string =>
  new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(mean);

function NumberHistogram({ card, split }: { card: QuestionCardModel; split?: SplitSpec }) {
  const values = card.numberValues!;
  const total = values.reduce((s, v) => s + v.count, 0);
  if (total === 0) return <p className="a-hint">אין ערכים מספריים.</p>;
  const mean = values.reduce((s, v) => s + v.value * v.count, 0) / total;

  if (split) {
    // אותם סלים לכל הקבוצות — השוואה דורשת צירים זהים; עמודה צמודה לכל קבוצה
    const bins = binNumbersByDim(card.atoms, 7);
    const max = Math.max(
      ...bins.flatMap((b) => Object.values(b.counts)),
      1,
    );
    return (
      <div className="nh-chart">
        <div className="nh-plot" dir="ltr">
          {bins.map((bin) => (
            <div
              key={bin.from}
              className="nh-col-slot cluster"
              title={`${formatCount(bin.from)}–${formatCount(bin.to)}`}
            >
              <span className="nh-cluster">
                {split.legend.values.map((v) => {
                  const count = bin.counts[v.key ?? UNKNOWN_DIM_KEY] ?? 0;
                  return (
                    <span
                      key={v.key ?? '∅'}
                      className="nh-col slim"
                      style={{ blockSize: `${(count / max) * 100}%`, background: v.color }}
                      title={`${v.label}: ${formatCount(count)}`}
                    />
                  );
                })}
              </span>
            </div>
          ))}
        </div>
        <div className="nh-axis" dir="ltr">
          <span>{formatCount(bins[0].from)}</span>
          <span>{formatCount(bins[bins.length - 1].to)}</span>
        </div>
      </div>
    );
  }

  const bins = binNumbers(values, 7);
  const max = Math.max(...bins.map((b) => b.count));
  return (
    <div className="nh-chart">
      {/* ציר מספרי קוראים משמאל לימין גם בעברית */}
      <div className="nh-plot" dir="ltr">
        {bins.map((bin) => (
          <div key={bin.from} className="nh-col-slot" title={`${formatCount(bin.from)}–${formatCount(bin.to)}: ${formatCount(bin.count)}`}>
            <span className="nh-count">{bin.count > 0 ? formatCount(bin.count) : ''}</span>
            <span
              className="nh-col"
              style={{ blockSize: `${max > 0 ? (bin.count / max) * 100 : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="nh-axis" dir="ltr">
        <span>{formatCount(bins[0].from)}</span>
        <span>{formatCount(bins[bins.length - 1].to)}</span>
      </div>
      <p className="a-hint q-note">ממוצע: {formatMean(mean)}</p>
    </div>
  );
}

function OverviewTiles({ bundle, includeTest }: { bundle: StatsBundle; includeTest: boolean }) {
  const tiles = overviewTiles(bundle.overview);
  if (bundle.overview.total_sessions === 0) {
    return (
      <p className="stats-empty">
        אין עדיין סשנים{includeTest ? '' : ' (לא כולל סשני בדיקה)'} — עדיין לא נכנס אף משיב
        בטווח הסינון הנוכחי.
      </p>
    );
  }
  return (
    <section aria-label="סקירה כללית">
      <div className="stat-tiles">
        {tiles.map((tile) => (
          <article key={tile.key} className="stat-tile">
            <div className="stat-num">{formatCount(tile.count)}</div>
            <div className="stat-label">
              {tile.label}
              {tile.ratio !== null && <span className="stat-pct"> · {formatPercent(tile.ratio)}</span>}
            </div>
            {tile.sub && (
              <ul className="stat-sub">
                {tile.sub.map((s) => (
                  <li key={s.label}>
                    {s.label}: {formatCount(s.count)}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
