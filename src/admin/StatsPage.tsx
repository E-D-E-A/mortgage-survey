// מסך הסטטיסטיקות של שאלון (/admin/<slug>/stats) — קריאה בלבד, בלי שום
// מנגנון טיוטה/שמירה. הנתונים נטענים טריים בכל ביקור ובכל שינוי פקד
// (ה-endpoint מסומן no-store): צפייה חיה בשטח חשובה מקאש.
// סשני בדיקה (?test=1) מוחרגים כברירת מחדל; המתג מחזיר אותם לצורך דיבוג.

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  ForbiddenError,
  getStats,
  UnauthorizedError,
  type StatsBundle,
} from './api';
import {
  binNumbers,
  formatCount,
  formatDuration,
  formatPercent,
  orderFunnel,
  overviewTiles,
  questionCards,
  type QuestionCardModel,
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
  const [load, setLoad] = useState<Load>({ phase: 'loading' });

  const fetchNow = useCallback(async () => {
    setLoad({ phase: 'loading' });
    try {
      const bundle = await getStats(slug, { version, includeTest });
      setLoad({ phase: 'ready', bundle });
    } catch (e) {
      if (e instanceof UnauthorizedError || e instanceof ForbiddenError) {
        onAuthError();
        return;
      }
      setLoad({ phase: 'error', status: e instanceof ApiError ? e.status : undefined });
    }
  }, [slug, version, includeTest, onAuthError]);

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

          {bundle && bundle.versions.length > 0 && (
            <>
              <OverviewTiles bundle={bundle} includeTest={includeTest} />
              {bundle.overview.total_sessions > 0 && (
                <>
                  <FunnelSection bundle={bundle} version={version} />
                  <DistributionsSection bundle={bundle} version={version} />
                </>
              )}
            </>
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

function DistributionsSection({ bundle, version }: { bundle: StatsBundle; version: string }) {
  const cards = questionCards(bundle.distributions, bundle.funnel, bundle.versions, version);
  if (cards.length === 0) return null;
  return (
    <section aria-label="התפלגויות תשובות">
      <h2 className="stats-section-title">מה ענו — שאלה אחר שאלה</h2>
      <div className="q-cards">
        {cards.map((card) => (
          <QuestionCard key={card.screenId} card={card} />
        ))}
      </div>
    </section>
  );
}

function QuestionCard({ card }: { card: QuestionCardModel }) {
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
        <ChoiceBars card={card} />
      ) : card.matrix ? (
        <MatrixChart matrix={card.matrix} />
      ) : card.numberValues ? (
        <NumberHistogram values={card.numberValues} />
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
function ChoiceBars({ card }: { card: QuestionCardModel }) {
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

function MatrixChart({ matrix }: { matrix: NonNullable<QuestionCardModel['matrix']> }) {
  const steps = matrix.scaleMax - matrix.scaleMin + 1;
  const keys = Array.from({ length: steps }, (_, i) => String(matrix.scaleMin + i));
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
      {matrix.items.map((item) => {
        const total = item.n + item.na;
        return (
          <div key={item.id} className="mx-row">
            <span className={`q-bar-label${item.retiredItem ? ' retired' : ''}`} title={item.label}>
              {item.retiredItem ? <code dir="ltr">{item.id}</code> : item.label}
            </span>
            <span className="mx-track">
              {total === 0 ? (
                <span className="a-hint">—</span>
              ) : (
                keys.map((k, i) => {
                  const count = item.counts[k] ?? 0;
                  if (count === 0) return null;
                  return (
                    <span
                      key={k}
                      className="mx-seg"
                      style={{ inlineSize: `${(count / total) * 100}%`, background: scaleColor(i, steps) }}
                      title={`${k}: ${formatCount(count)}`}
                    />
                  );
                })
              )}
              {item.na > 0 && (
                <span
                  className="mx-seg"
                  style={{ inlineSize: `${(item.na / total) * 100}%`, background: NA_COLOR }}
                  title={`${matrix.naLabel ?? 'na'}: ${formatCount(item.na)}`}
                />
              )}
            </span>
            <span className="q-bar-value">
              {item.mean !== null ? (
                <>
                  ממוצע <span className="q-bar-pct">{formatMean(item.mean)}</span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const formatMean = (mean: number): string =>
  new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(mean);

function NumberHistogram({ values }: { values: { value: number; count: number }[] }) {
  const bins = binNumbers(values, 7);
  if (bins.length === 0) return <p className="a-hint">אין ערכים מספריים.</p>;
  const max = Math.max(...bins.map((b) => b.count));
  const total = values.reduce((s, v) => s + v.count, 0);
  const mean = values.reduce((s, v) => s + v.value * v.count, 0) / total;
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
