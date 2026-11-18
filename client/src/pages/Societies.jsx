import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, useDataChanged } from '../hooks.js';
import { EventCard, Alert, Empty, Loading, useActions, StatusBadge, SocietyLogo, EmptyState } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

const MEMBERSHIP_TEXT = {
  approved: 'You are a member of this society.',
  pending: 'Your request is waiting for the president to review it.',
  rejected: 'Your last request was declined. You can request again.',
  removed: 'You were removed from this society. You can request again.',
};

const dateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export function Societies() {
  const { data, error, loading } = useApi('/societies');
  const [category, setCategory] = useState('');
  const categories = [...new Set((data ?? []).map((s) => s.category))].sort();
  const visible = (data ?? []).filter((s) => !category || s.category === category);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Discover</p>
          <h1>Societies</h1>
          <p className="muted">Browse every registered society, then request to join the ones that interest you.</p>
        </div>
        <label className="inline">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {loading && <Loading />}
      <Alert>{error}</Alert>
      {data && visible.length === 0 && <EmptyState icon="building" title="No societies found">Try a different category.</EmptyState>}
      <div className="grid">
        {visible.map((s) => (
          <Link key={s.id} to={`/societies/${s.id}`} className="card society-card">
            <div className="society-card-top">
              <SocietyLogo societyId={s.id} name={s.name} hasLogo={Boolean(s.has_logo)} size={48} />
              {s.my_status && <StatusBadge value={s.my_status} />}
            </div>
            <p className="eyebrow">{s.category}</p>
            <h3>{s.name}</h3>
            <p className="muted small">Led by {s.president_name}</p>
            <p className="muted small society-count"><Icon name="users" size={14} /> {s.member_count} member{s.member_count === 1 ? '' : 's'}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

export function SocietyDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: society, error, loading, reload } = useApi(`/societies/${id}`);
  const act = useActions();
  const onChange = useCallback(() => reload(), [reload]);
  useDataChanged(onChange);

  if (error) return <Alert>{error}</Alert>;
  if (loading && !society) return <Loading />;
  if (!society) return null;

  const isStudent = user?.role === 'student';
  const isOwner = user?.role === 'president' && society.owner_id === user.id;
  const canRequest = isStudent && !['approved', 'pending'].includes(society.my_status);
  const upcoming = society.events.filter((e) => e.schedule_status === 'upcoming').length;
  const ongoing = society.events.filter((e) => e.schedule_status === 'ongoing').length;

  async function requestToJoin() {
    const result = await act.run(
      () => api(`/societies/${id}/membership-requests`, { method: 'POST' }),
      'Your request was sent to the president.',
    );
    if (result !== undefined) reload();
  }

  return (
    <>
      <header className="dash-hero profile-hero">
        <div className="profile-identity">
          <SocietyLogo societyId={society.id} name={society.name} hasLogo={Boolean(society.has_logo)} size={88} />
          <div className="dash-hero-text">
            <p className="eyebrow">{society.category}</p>
            <h1>{society.name}</h1>
            <p className="dash-sub">Led by {society.president_name} · Established {dateOnly(society.created_at)}</p>
          </div>
        </div>
        <div className="dash-hero-actions">
          <Link className="btn" to={`/events?society=${society.id}`}>
            <Icon name="calendar" size={16} /> View events
          </Link>
          {isOwner && <Link className="btn btn-primary" to="/president">Manage society</Link>}
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card tone-indigo">
          <div className="stat-icon"><Icon name="users" size={18} /></div>
          <div className="stat-body">
            <span className="stat-label">Members</span>
            <strong className="stat-value">{society.member_count}</strong>
            <span className="stat-hint">Approved members</span>
          </div>
        </div>
        <div className="stat-card tone-cyan">
          <div className="stat-icon"><Icon name="calendar" size={18} /></div>
          <div className="stat-body">
            <span className="stat-label">Upcoming events</span>
            <strong className="stat-value">{upcoming}</strong>
            <span className="stat-hint">Approved and not started</span>
          </div>
        </div>
        <div className="stat-card tone-emerald">
          <div className="stat-icon"><Icon name="activity" size={18} /></div>
          <div className="stat-body">
            <span className="stat-label">Happening now</span>
            <strong className="stat-value">{ongoing}</strong>
            <span className="stat-hint">Ongoing events</span>
          </div>
        </div>
        <div className="stat-card tone-amber">
          <div className="stat-icon"><Icon name="shield" size={18} /></div>
          <div className="stat-body">
            <span className="stat-label">Membership</span>
            <strong className="stat-value stat-small">{isStudent ? (society.my_status ? society.my_status.replace(/^./, (c) => c.toUpperCase()) : 'Not a member') : isOwner ? 'Owner' : 'Public'}</strong>
            <span className="stat-hint">{isStudent ? 'Your status' : 'Your role here'}</span>
          </div>
        </div>
      </section>

      <Alert>{act.error}</Alert>
      <Alert kind="success">{act.message}</Alert>

      <div className="profile-grid">
        <section className="card profile-about">
          <h2>About</h2>
          <p className="pre">{society.description || 'This society has not added a description yet.'}</p>
          <dl className="contact-list">
            <dt><Icon name="globe" size={15} /> Email</dt>
            <dd>{society.contact_email ? <a href={`mailto:${society.contact_email}`}>{society.contact_email}</a> : <span className="muted">Not provided</span>}</dd>
            <dt><Icon name="user" size={15} /> Phone</dt>
            <dd>{society.contact_phone ? <a href={`tel:${society.contact_phone.replace(/\s+/g, '')}`}>{society.contact_phone}</a> : <span className="muted">Not provided</span>}</dd>
          </dl>
        </section>

        <aside className="card profile-membership">
          <h2>Membership</h2>
          {isStudent ? (
            <div className="stack">
              {society.my_status && <StatusBadge value={society.my_status} />}
              <p>{MEMBERSHIP_TEXT[society.my_status] ?? 'Request to join this society to take part in its events and meetings.'}</p>
              {canRequest && (
                <button className="btn btn-primary" onClick={requestToJoin} disabled={act.busy}>Request to join</button>
              )}
            </div>
          ) : isOwner ? (
            <p className="muted">You are the president of this society. Manage members and events from your dashboard.</p>
          ) : (
            <p className="muted">Membership is managed by the society president. Students request to join after logging in.</p>
          )}
        </aside>
      </div>

      <section className="section">
        <div className="page-head">
          <div>
            <h2>Upcoming and ongoing events</h2>
            <p className="muted small">Approved events from this society. Open an event to see details and register.</p>
          </div>
        </div>
        {society.events.length === 0 && (
          <EmptyState icon="calendar" title="No events scheduled">This society has no approved upcoming or ongoing events right now.</EmptyState>
        )}
        <div className="grid">
          {society.events.map((ev) => <EventCard key={ev.id} ev={ev} />)}
        </div>
      </section>
    </>
  );
}
