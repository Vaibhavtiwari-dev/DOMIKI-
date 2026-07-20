import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SignupLanding } from './components/SignupLanding';
import { DemoDashboard } from './components/DemoDashboard';
import './index.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SignupLanding />} />
        <Route path="/demo" element={<DemoDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
