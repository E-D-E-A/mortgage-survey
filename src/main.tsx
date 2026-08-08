import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import { slugFromPath } from './data/surveys';
import { setSurveyScope } from './data/session-scope';
import './styles.css';

// קונסולת הניהול נטענת כ-chunk נפרד — קוד העריכה (dnd-kit, Supabase Auth)
// לא נכנס לבאנדל שהמשיבים מורידים.
const AdminApp = lazy(() => import('./admin/AdminApp'));

const isAdmin = window.location.pathname.startsWith('/admin');

// ‎/s/<slug>‎ בוחר שאלון; ‎/‎ הוא שאלון ברירת המחדל (קישורים ותיקים).
// ההגבלה חייבת להיקבע לפני הרינדור — כל מפתחות הסשן נגזרים ממנה.
const slug = isAdmin ? null : slugFromPath(window.location.pathname);
if (slug) setSurveyScope(slug);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense fallback={<div className="app" />}>
        <AdminApp />
      </Suspense>
    ) : (
      <AppShell slug={slug} />
    )}
  </StrictMode>,
);
