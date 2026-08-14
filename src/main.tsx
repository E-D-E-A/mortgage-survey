import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import { slugFromPath } from './data/surveys';
import { setSurveyScope } from './data/session-scope';
import './styles.css';

// The admin console loads as a separate chunk — the editing code (dnd-kit,
// Supabase Auth) never enters the bundle respondents download.
const AdminApp = lazy(() => import('./admin/AdminApp'));

const isAdmin = window.location.pathname.startsWith('/admin');

// `/s/<slug>` selects a survey; `/` is the default survey (old links). The scope
// has to be set before rendering — every session key is derived from it.
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
