import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Alert } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

const MIN_PASSWORD_LENGTH = 8;

// Two steps: request a reset code by email, then enter the code and a new password.
export default function ResetPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const health = useApi('/health');

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(e) {
    e?.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setInfo(data.message);
      setStep('reset');
      setCooldown(60);
    } catch (err) {
      setError(err.message);
      if (err.status === 429) {
        setStep('reset');
        setCooldown(60);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/auth/reset-password', { method: 'POST', body: { email, code, password } });
      navigate('/login', { replace: true, state: { notice: data.message } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Reset your password</h1>

        {step === 'email' && (
          <form className="stack" onSubmit={requestCode}>
            <p className="muted small">Enter the email for your account. We will send a six-digit code to it.</p>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <Alert>{error}</Alert>
            <button className="btn btn-primary" type="submit" disabled={busy || !email}>Send reset code</button>
            <p className="muted small"><Link to="/login">Back to log in</Link></p>
          </form>
        )}

        {step === 'reset' && (
          <form className="stack" onSubmit={resetPassword}>
            <Alert kind="info">{info}</Alert>
            <p className="muted small">
              The code expires in 10 minutes.{' '}
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
            <label>
              New password <span className="muted small">(at least 8 characters)</span>
              <input type="password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label>
              Confirm new password
              <input type="password" required minLength={MIN_PASSWORD_LENGTH} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </label>
            <Alert>{error}</Alert>
            <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6 || !password || !confirm}>
              Reset password
            </button>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={requestCode} disabled={busy || cooldown > 0}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }}>
                Change email
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
