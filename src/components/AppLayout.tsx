import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { readResearchSession } from '../services/api';

export function AppLayout() {
  const location = useLocation();
  const [session, setSession] = useState<{
    path: string;
    status: 'checking' | 'active' | 'inactive';
  }>({ path: '/', status: 'inactive' });

  useEffect(() => {
    let cancelled = false;
    if (location.pathname === '/') {
      setSession({ path: '/', status: 'inactive' });
      return undefined;
    }
    const requestedPath = location.pathname;
    setSession({ path: requestedPath, status: 'checking' });
    void readResearchSession()
      .then(({ active }) => {
        if (!cancelled) {
          setSession({ path: requestedPath, status: active ? 'active' : 'inactive' });
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ path: requestedPath, status: 'inactive' });
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const isProtectedRoute = location.pathname !== '/';
  const isCheckingCurrentPath = session.path !== location.pathname || session.status === 'checking';

  if (isProtectedRoute && isCheckingCurrentPath) {
    return <main className="route-loading">Initializing research workspace…</main>;
  }
  if (isProtectedRoute && session.status !== 'active') return <Navigate to="/" replace />;
  return <Outlet />;
}
