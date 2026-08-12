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
import { formatCount, formatDuration, formatPercent, orderFunnel, overviewTiles } from './stats';
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
                <FunnelSection bundle={bundle} version={version} />
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
