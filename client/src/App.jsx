import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { homePathFor } from './roles.js';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import AuthPage from './pages/Auth.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import PublicEvent from './pages/PublicEvent.jsx';
import PublicEvents from './pages/PublicEvents.jsx';
import { Societies, SocietyDetail } from './pages/Societies.jsx';
import StudentDashboard from './pages/Student.jsx';
import PresidentDashboard from './pages/President.jsx';
import ManageEvent from './pages/ManageEvent.jsx';
import AdminDashboard from './pages/Admin.jsx';

// Requires login, and optionally one of the given roles.
function Guard({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />
        <Route path="forgot-password" element={<ResetPassword />} />
        <Route path="events" element={<PublicEvents />} />
        <Route path="events/:id" element={<PublicEvent />} />
        <Route path="societies" element={<Guard><Societies /></Guard>} />
        <Route path="societies/:id" element={<Guard><SocietyDetail /></Guard>} />
        <Route path="student" element={<Guard roles={['student']}><StudentDashboard /></Guard>} />
        <Route path="president" element={<Guard roles={['president']}><PresidentDashboard /></Guard>} />
        <Route path="president/events/:id" element={<Guard roles={['president']}><ManageEvent /></Guard>} />
        <Route path="admin" element={<Guard roles={['admin']}><AdminDashboard /></Guard>} />
        <Route path="*" element={<div className="card"><h2>Page not found</h2></div>} />
      </Route>
    </Routes>
  );
}
