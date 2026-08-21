import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import LandingPage from './LandingPage';
import { resolveRoute } from './data/surveys';
import { setSurveyScope } from './data/session-scope';
import './styles.css';

// The admin console loads as a separate chunk — the editing code (dnd-kit,
// Supabase Auth) never enters the bundle respondents download.
const AdminApp = lazy(() => import('./admin/AdminApp'));

// `/s/<slug>` is the only shape that serves a survey. `/` and anything else get
// the landing page — deliberately not a survey, so no session is recorded (see
// resolveRoute). The scope has to be set before rendering: every session key is
// derived from it.
const route = resolveRoute(window.location.pathname);
if (route.kind === 'survey') setSurveyScope(route.slug);

function Root() {
  switch (route.kind) {
    case 'admin':
      return (
        <Suspense fallback={<div className="app" />}>
          <AdminApp />
        </Suspense>
      );
    case 'survey':
      return <AppShell slug={route.slug} />;
    case 'broken-link':
      return <AppShell slug={null} />;
    case 'landing':
      return <LandingPage />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
