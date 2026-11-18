import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { homePathFor } from '../roles.js';
import { Alert } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

// Email and password first, then the six-digit email code (second factor).
export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const notice = useLocation().state?.notice;
  const health = useApi('/health');
  const afterLogin = (role) => (next && next.startsWith('/') ? next : homePathFor(role));

  const [step, setStep] = useState('form');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [code, setCode] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (user && step === 'form') return <Navigate to={afterLogin(user.role)} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Sends a code. Registration creates the account first; resend always goes through login.
  async function sendCode(e) {
    e?.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (isRegister && step === 'form') {
        await api('/auth/register', {
          method: 'POST',
          body: { name: form.name, email: form.email, password: form.password, role: form.role },
        });
      } else {
        await api('/auth/login', { method: 'POST', body: { email: form.email, password: form.password } });
      }
      setInfo(`A six-digit code was sent to ${form.email}. It expires in 10 minutes.`);
      setStep('otp');
      setCooldown(60);
    } catch (err) {
      setError(err.message);
      if (err.status === 429) {
        setStep('otp');
        setCooldown(60);
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/verify-otp', { method: 'POST', body: { email: form.email, code } });
      signIn(data.token, data.user);
      navigate(afterLogin(data.user.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const registerLink = `/register${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  const loginLink = `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{isRegister ? 'Create your account' : 'Log in'}</h1>

        {step === 'form' && (
          <form className="stack" onSubmit={sendCode}>
            {isRegister && (
              <>
                <label>
                  Full name
                  <input required value={form.name} onChange={set('name')} />
                </label>
                <fieldset className="radio-group">
                  <legend>I am a</legend>
                  <label className="radio">
                    <input type="radio" name="role" value="student" checked={form.role === 'student'} onChange={set('role')} />
                    Student / Volunteer
                  </label>
                  <label className="radio">
                    <input type="radio" name="role" value="president" checked={form.role === 'president'} onChange={set('role')} />
                    Society President / Organizer
                  </label>
                </fieldset>
              </>
            )}
            <label>
              Email
              <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
            </label>
            <label>
              Password {isRegister && <span className="muted small">(at least 8 characters)</span>}
              <input
                type="password"
                required
                minLength={isRegister ? 8 : undefined}
                value={form.password}
                onChange={set('password')}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </label>
            <Alert kind="success">{notice}</Alert>
            <Alert>{error}</Alert>
            {!isRegister && (
              <p className="small" style={{ margin: 0, textAlign: 'right' }}>
                <Link to="/forgot-password">Forgot password?</Link>
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {isRegister ? 'Create account and send code' : 'Continue'}
            </button>
            <p className="muted small">
              {isRegister ? (
                <>Already have an account? <Link to={loginLink}>Log in</Link></>
              ) : (
                <>New here? <Link to={registerLink}>Create an account</Link></>
              )}
            </p>
          </form>
        )}

        {step === 'otp' && (
          <form className="stack" onSubmit={verify}>
            <Alert kind="info">{info}</Alert>
            <p className="muted small">
              {health.data?.emailConfigured
                ? 'Check your inbox and Spam folder.'
                : 'Email is not configured on this server, so the code is printed in the API server console.'}
            </p>
            <label>
              Six-digit code
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                className="code-input"
              />
            </label>
            <Alert>{error}</Alert>
            <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>Verify and continue</button>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={sendCode} disabled={busy || cooldown > 0}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => { setStep('form'); setCode(''); setError(''); }}>
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
