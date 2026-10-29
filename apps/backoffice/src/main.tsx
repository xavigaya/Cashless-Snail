import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { EventLayout } from './pages/event/EventLayout';
import { SummaryTab } from './pages/event/SummaryTab';
import { SettingsTab } from './pages/event/SettingsTab';
import { CatalogTab } from './pages/event/CatalogTab';
import { StaffTab } from './pages/event/StaffTab';
import { MovementsTab } from './pages/event/MovementsTab';
import { WristbandsTab } from './pages/event/WristbandsTab';
import './styles.css';

function Shell() {
  const { user, loading, logout } = useSession();
  if (loading) return <main className="muted">Carregant…</main>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Cashless <span>Snail</span>
        </Link>
        <div className="topbar-user">
          <span>{user.name}</span>
          <button onClick={logout}>Surt</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Shell />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        path: '/events/:eventId',
        element: <EventLayout />,
        children: [
          { index: true, element: <SummaryTab /> },
          { path: 'settings', element: <SettingsTab /> },
          { path: 'catalog', element: <CatalogTab /> },
          { path: 'staff', element: <StaffTab /> },
          { path: 'movements', element: <MovementsTab /> },
          { path: 'wristbands', element: <WristbandsTab /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
], {
  // Quan es publica en una subcarpeta (p. ex. GitHub Pages: /Cashless-Snail/), les rutes hi pengen.
  basename: import.meta.env.BASE_URL.replace(/\/+$/, '') || '/',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
