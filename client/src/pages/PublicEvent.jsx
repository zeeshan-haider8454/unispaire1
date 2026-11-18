import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, useEventRoom } from '../hooks.js';
import { formatPKT } from '../format.js';
import { Alert, Loading, ScheduleBadge, useActions } from '../components/ui.jsx';

function closedReason(ev) {
  if (ev.status === 'cancelled') return 'This event was cancelled.';
  if (ev.schedule_status === 'completed') return 'Registration is closed because the event has ended.';
  if (ev.schedule_status === 'ongoing') return 'Registration is closed because the event has started.';
  if (ev.seats_remaining <= 0) return 'This event is full.';
  return 'The registration deadline has passed.';
}

export default function PublicEvent() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: ev, error, reload } = useApi(`/events/${id}`);
  const act = useActions();

  // Seats and status update live while the page is open.
  const onUpdate = useCallback(() => reload(), [reload]);
  useEventRoom(id, onUpdate);

  if (error) return <Alert>{error}</Alert>;
  if (!ev) return <Loading />;

  const isStudent = user?.role === 'student';
  const registered = ev.my_registration === 'registered';
  const canCancelRegistration = registered && ev.schedule_status === 'upcoming' && ev.status !== 'cancelled';
  const loginNext = `next=${encodeURIComponent(`/events/${id}`)}`;

  async function register() {
    const result = await act.run(() => api(`/events/${id}/register`, { method: 'POST' }), 'You are registered for this event.');
    if (result !== undefined) reload();
  }

  async function unregister() {
    const result = await act.run(() => api(`/events/${id}/register`, { method: 'DELETE' }), 'Your registration was cancelled.');
    if (result !== undefined) reload();
  }

  return (
    <article className="event-page">
      <div className="event-head">
        <ScheduleBadge value={ev.schedule_status} />
        <h1>{ev.title}</h1>
        <p className="muted">
          Organized by{' '}
          {user ? <Link to={`/societies/${ev.society_id}`}>{ev.society_name}</Link> : ev.society_name}
        </p>
      </div>

      <div className="split">
        <div className="card">
          <h2>About this event</h2>
          <p className="pre">{ev.description || 'No description provided.'}</p>
        </div>

        <aside className="card">
          <dl className="details">
            <dt>Venue</dt>
            <dd>{ev.venue}</dd>
            <dt>Starts</dt>
            <dd>{formatPKT(ev.start_at)}</dd>
            <dt>Ends</dt>
            <dd>{formatPKT(ev.end_at)}</dd>
            <dt>Registration deadline</dt>
            <dd>{formatPKT(ev.registration_deadline)}</dd>
            <dt>Capacity</dt>
            <dd>{ev.capacity}</dd>
            <dt>Seats remaining</dt>
            <dd>{ev.seats_remaining}</dd>
          </dl>

          <Alert>{act.error}</Alert>
          <Alert kind="success">{act.message}</Alert>

          {!user && (
            <div className="stack">
              <p>Log in or sign up to register. Your place on this event is kept through sign-up and verification.</p>
              <div className="row">
                <Link className="btn btn-primary" to={`/login?${loginNext}`}>Log in to register</Link>
                <Link className="btn" to={`/register?${loginNext}`}>Sign up</Link>
              </div>
            </div>
          )}

          {isStudent && (
            <div className="stack">
              {registered && <p className="badge badge-approved">You are registered</p>}
              {registered && canCancelRegistration && (
                <button className="btn" onClick={unregister} disabled={act.busy}>Cancel my registration</button>
              )}
              {!registered && ev.actions.register && (
                <button className="btn btn-primary" onClick={register} disabled={act.busy}>Register</button>
              )}
              {!registered && !ev.actions.register && <p className="muted">{closedReason(ev)}</p>}
              {ev.my_invitation === 'invited' && (
                <p>You have a volunteer invitation for this event. <Link to="/student">Respond on your dashboard</Link>.</p>
              )}
            </div>
          )}

          {user && !isStudent && <p className="muted">Students register for events. You are signed in as {user.role}.</p>}
        </aside>
      </div>
    </article>
  );
}
