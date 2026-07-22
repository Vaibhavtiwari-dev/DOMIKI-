import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';

const SignupLanding = lazy(() =>
  import('./components/SignupLanding').then((module) => ({ default: module.SignupLanding })),
);
const DemoDashboard = lazy(() =>
  import('./components/DemoDashboard').then((module) => ({ default: module.DemoDashboard })),
);
const AppLayout = lazy(() =>
  import('./components/AppLayout').then((module) => ({ default: module.AppLayout })),
);

function App() {
  return (
    <AppErrorBoundary>
      <Router>
        <Suspense fallback={<main className="route-loading">Initializing Dokimi…</main>}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<SignupLanding />} />
              <Route path="/demo" element={<DemoDashboard />} />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </AppErrorBoundary>
  );
}

export default App;
