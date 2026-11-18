import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPKT, labelize, SCHEDULE_LABELS, STATUS_LABELS } from '../format.js';
import Icon from './Icon.jsx';

// Dashboard header banner. Keeps the page title, subtitle and actions in one place.
export function DashHero({ eyebrow, title, subtitle, actions, children }) {
  return (
    <header className="dash-hero">
      <div className="dash-hero-text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="dash-sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="dash-hero-actions">{actions}</div>}
    </header>
  );
}

export function StatCard({ icon, label, value, hint, tone = 'indigo' }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon">{icon && <Icon name={icon} size={18} />}</div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function Panel({ title, count, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>
          {title}
          {count !== undefined && <span className="count-chip">{count}</span>}
        </h2>
        {action && <div className="panel-action">{action}</div>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function EmptyState({ icon = 'inbox', title, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      {title && <strong>{title}</strong>}
      {children && <span className="muted small">{children}</span>}
    </div>
  );
}

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function Empty({ children }) {
  return <p className="muted empty">{children}</p>;
}

export function StatusBadge({ value }) {
  return <span className={`badge badge-${value}`}>{STATUS_LABELS[value] ?? labelize(value)}</span>;
}

export function ScheduleBadge({ value }) {
  return <span className={`badge badge-${value}`}>{SCHEDULE_LABELS[value] ?? labelize(value)}</span>;
}

export function ProgressBar({ value }) {
  return (
    <div className="progress" aria-label={`${value}% complete`}>
      <div className="progress-fill" style={{ width: `${value}%` }} />
      <span>{value}%</span>
    </div>
  );
}

// Copies any text (for example a shareable link) to the clipboard.
export function CopyTextButton({ text, label = 'Copy link', copiedLabel = 'Copied' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link:', text);
    }
  }
  return (
    <button type="button" className="btn btn-primary" onClick={copy}>
      {copied ? copiedLabel : label}
    </button>
  );
}

// Copies the full public URL of an event page to the clipboard.
export function CopyLinkButton({ eventId, small = true }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = `${window.location.origin}/events/${eventId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this public link:', url);
    }
  }
  return (
    <button type="button" className={`btn ${small ? 'btn-small' : ''}`} onClick={copy}>
      {copied ? 'Copied' : 'Copy public link'}
    </button>
  );
}

export function EventCard({ ev }) {
  return (
    <Link to={`/events/${ev.id}`} className="card event-card">
      <ScheduleBadge value={ev.schedule_status} />
      <h3>{ev.title}</h3>
      <p className="muted">{ev.society_name}</p>
      <dl>
        <dt>Starts</dt>
        <dd>{formatPKT(ev.start_at)}</dd>
        <dt>Venue</dt>
        <dd>{ev.venue}</dd>
        <dt>Seats left</dt>
        <dd>{ev.seats_remaining} of {ev.capacity}</dd>
      </dl>
    </Link>
  );
}

// Runs an async action with shared busy and error state.
export function useActions() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const run = useCallback(async (fn, success = '') => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await fn();
      if (success) setMessage(success);
      return result;
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, message, run, setError, setMessage };
}
