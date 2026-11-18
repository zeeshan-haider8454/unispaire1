import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, useDataChanged } from '../hooks.js';
import { EventCard, Alert, Empty, Loading, useActions, StatusBadge } from '../components/ui.jsx';

const MEMBERSHIP_TEXT = {
  approved: 'You are a member of this society.',
  pending: 'Your request is waiting for the president to review it.',
  rejected: 'Your last request was declined. You can request again.',
  removed: 'You were removed from this society. You can request again.',
};

export function Societies() {
  const { data, error, loading } = useApi('/societies');
  const [category, setCategory] = useState('');
  const categories = [...new Set((data ?? []).map((s) => s.category))].sort();
  const visible = (data ?? []).filter((s) => !category || s.category === category);

  return (
    <>
      <div className="page-head">
        <h1>Societies</h1>
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
      {data && visible.length === 0 && <Empty>No societies found.</Empty>}
      <div className="grid">
        {visible.map((s) => (
          <Link key={s.id} to={`/societies/${s.id}`} className="card society-card">
            <p className="eyebrow">{s.category}</p>
            <h3>{s.name}</h3>
            <p className="muted">President: {s.president_name}</p>
            <p className="muted small">{s.member_count} member(s)</p>
            {s.my_status && <StatusBadge value={s.my_status} />}
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
  const canRequest = isStudent && !['approved', 'pending'].includes(society.my_status);

  async function requestToJoin() {
    const result = await act.run(
      () => api(`/societies/${id}/membership-requests`, { method: 'POST' }),
      'Your request was sent to the president.',
    );
    if (result !== undefined) reload();
  }

  return (
    <>
      <div className="event-head">
        <p className="eyebrow">{society.category}</p>
        <h1>{society.name}</h1>
        <p className="muted">President: {society.president_name} · {society.member_count} member(s)</p>
      </div>

      <div className="split">
        <div className="card">
          <h2>About</h2>
          <p className="pre">{society.description || 'No description provided.'}</p>
          <p className="muted small">
            Contact: {society.contact_email || '—'} {society.contact_phone && `· ${society.contact_phone}`}
          </p>
        </div>

        <aside className="card stack">
          <h2>Membership</h2>
          {isStudent ? (
            <>
              {society.my_status && <StatusBadge value={society.my_status} />}
              <p>{MEMBERSHIP_TEXT[society.my_status] ?? 'Request to join this society to take part in its events.'}</p>
              {canRequest && (
                <button className="btn btn-primary" onClick={requestToJoin} disabled={act.busy}>Request to join</button>
              )}
            </>
          ) : (
            <p className="muted">Membership is managed by the society president.</p>
          )}
          <Alert>{act.error}</Alert>
          <Alert kind="success">{act.message}</Alert>
        </aside>
      </div>

      <h2 className="section-title">Upcoming events</h2>
      {society.events.length === 0 && <Empty>No upcoming approved events from this society.</Empty>}
      <div className="grid">
        {society.events.map((ev) => <EventCard key={ev.id} ev={ev} />)}
      </div>
    </>
  );
}
