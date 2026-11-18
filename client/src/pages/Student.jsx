import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, useDataChanged } from '../hooks.js';
import { formatPKT, labelize, TASK_STATUS_LABELS } from '../format.js';
import { Alert, DashHero, EmptyState, Loading, Panel, StatCard, StatusBadge, useActions } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function StudentDashboard() {
  const { user } = useAuth();
  const invitations = useApi('/invitations/mine');
  const registrations = useApi('/registrations/mine');
  const tasks = useApi('/tasks/mine');
  const memberships = useApi('/societies/memberships/mine');
  const meetings = useApi('/meetings/mine');
  const act = useActions();

  // Refetch everything when the server reports a change for this student.
  const reloadAll = useCallback(() => {
    invitations.reload();
    registrations.reload();
    tasks.reload();
    memberships.reload();
    meetings.reload();
  }, [invitations.reload, registrations.reload, tasks.reload, memberships.reload, meetings.reload]);
  useDataChanged(reloadAll);

  async function respond(id, accept) {
    const result = await act.run(
      () => api(`/invitations/${id}/respond`, { method: 'POST', body: { accept } }),
      accept ? 'Invitation accepted.' : 'Invitation declined.',
    );
    if (result !== undefined) reloadAll();
  }

  async function respondMeeting(invitationId, accept) {
    const result = await act.run(
      () => api(`/meetings/invitations/${invitationId}/respond`, { method: 'POST', body: { accept } }),
      accept ? 'Meeting accepted.' : 'Meeting declined.',
    );
    if (result !== undefined) reloadAll();
  }

  async function withdraw(inv) {
    if (!window.confirm(`Withdraw from volunteering for "${inv.title}"? Your unfinished tasks will be unassigned.`)) return;
    const result = await act.run(
      () => api(`/invitations/${inv.id}/withdraw`, { method: 'POST' }),
      'You have withdrawn from volunteering.',
    );
    if (result !== undefined) reloadAll();
  }

  async function cancelRegistration(eventId, title) {
    if (!window.confirm(`Cancel your registration for "${title}"?`)) return;
    const result = await act.run(() => api(`/events/${eventId}/register`, { method: 'DELETE' }), 'Registration cancelled.');
    if (result !== undefined) reloadAll();
  }

  async function setTaskStatus(taskId, status) {
    const result = await act.run(() => api(`/tasks/${taskId}`, { method: 'PATCH', body: { status } }), 'Task updated.');
    if (result !== undefined) reloadAll();
  }

  const isUpcoming = (r) => Date.parse(r.start_at) > Date.now() && r.event_status !== 'cancelled';

  const pendingInvites = invitations.data?.filter((i) => i.status === 'invited').length ?? 0;
  const openTasks = tasks.data?.filter((t) => t.status !== 'completed').length ?? 0;
  const upcomingRegs = registrations.data?.filter((r) => r.status === 'registered' && isUpcoming(r)).length ?? 0;
  const memberOf = memberships.data?.filter((m) => m.status === 'approved').length ?? 0;

  return (
    <>
      <DashHero
        eyebrow="Student dashboard"
        title={user?.name ? `Hello, ${user.name.split(' ')[0]}` : 'My dashboard'}
        subtitle="Your invitations, tasks, registrations and memberships in one place."
        actions={<Link className="btn" to="/societies">Browse societies</Link>}
      />

      <section className="stats-grid">
        <StatCard icon="inbox" label="Invitations" value={pendingInvites} hint="Awaiting your reply" tone="amber" />
        <StatCard icon="layers" label="Open tasks" value={openTasks} hint="Not yet completed" tone="indigo" />
        <StatCard icon="ticket" label="Upcoming events" value={upcomingRegs} hint="You are registered" tone="cyan" />
        <StatCard icon="shield" label="Memberships" value={memberOf} hint="Societies you belong to" tone="emerald" />
      </section>

      <Alert>{act.error}</Alert>
      <Alert kind="success">{act.message}</Alert>

      <div className="dash-grid">
        <Panel title="Volunteer invitations" count={invitations.data?.length ?? 0}>
          {invitations.loading && !invitations.data && <Loading />}
          <Alert>{invitations.error}</Alert>
          {invitations.data?.length === 0 && (
            <EmptyState icon="inbox" title="No invitations yet">When a society invites you to volunteer, it appears here.</EmptyState>
          )}
          <div className="list">
            {invitations.data?.map((inv) => (
              <div key={inv.id} className="item-card">
                <div>
                  <h3>{inv.title}</h3>
                  <p className="muted small">{inv.society_name} · {formatPKT(inv.start_at)} · {inv.venue}</p>
                </div>
                {inv.status === 'invited' && inv.event_status !== 'cancelled' ? (
                  <div className="row">
                    <button className="btn btn-primary btn-small" onClick={() => respond(inv.id, true)} disabled={act.busy}>Accept</button>
                    <button className="btn btn-small" onClick={() => respond(inv.id, false)} disabled={act.busy}>Decline</button>
                  </div>
                ) : inv.status === 'accepted' && inv.event_status !== 'cancelled' ? (
                  <div className="row">
                    <StatusBadge value="accepted" />
                    <button className="btn btn-small" onClick={() => withdraw(inv)} disabled={act.busy}>Withdraw</button>
                  </div>
                ) : (
                  <StatusBadge value={inv.event_status === 'cancelled' && inv.status === 'invited' ? 'cancelled' : inv.status} />
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="My tasks" count={tasks.data?.length ?? 0}>
          <Alert>{tasks.error}</Alert>
          {tasks.data?.length === 0 && (
            <EmptyState icon="layers" title="No tasks assigned">Tasks from the events you volunteer for appear here.</EmptyState>
          )}
          <div className="list">
            {tasks.data?.map((t) => (
              <div key={t.id} className="item-card">
                <div>
                  <h3>{t.title}</h3>
                  <p className="muted small">
                    {t.event_title} · Due {formatPKT(t.due_at)} · <span className={`prio prio-${t.priority}`}>{labelize(t.priority)}</span>
                  </p>
                  {t.description && <p className="small">{t.description}</p>}
                </div>
                <label className="inline">
                  Status
                  <select
                    value={t.status}
                    disabled={t.event_status === 'cancelled' || act.busy}
                    onChange={(e) => setTaskStatus(t.id, e.target.value)}
                  >
                    {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="My event registrations" count={registrations.data?.length ?? 0}>
          <Alert>{registrations.error}</Alert>
          {registrations.data?.length === 0 && (
            <EmptyState icon="ticket" title="No registrations yet">
              <Link to="/">Browse upcoming events</Link> and register for one.
            </EmptyState>
          )}
          <div className="list">
            {registrations.data?.map((r) => (
              <div key={r.id} className="item-card">
                <div>
                  <h3><Link to={`/events/${r.event_id}`}>{r.title}</Link></h3>
                  <p className="muted small">{r.society_name} · {formatPKT(r.start_at)}</p>
                </div>
                <div className="row">
                  <StatusBadge value={r.status} />
                  {r.status === 'registered' && isUpcoming(r) && (
                    <button className="btn btn-small" onClick={() => cancelRegistration(r.event_id, r.title)} disabled={act.busy}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="My society memberships" count={memberships.data?.length ?? 0}>
          {memberships.data?.length === 0 && (
            <EmptyState icon="users" title="No memberships yet">
              You have not requested to join a society. <Link to="/societies">Browse societies</Link>.
            </EmptyState>
          )}
          <div className="list">
            {memberships.data?.map((m) => (
              <div key={m.id} className="item-card">
                <Link to={`/societies/${m.society_id}`}>{m.society_name}</Link>
                <StatusBadge value={m.status} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Meetings" count={meetings.data?.length ?? 0}>
        <Alert>{meetings.error}</Alert>
        {meetings.data?.length === 0 && (
          <EmptyState icon="calendar" title="No meeting invitations">Meetings your society schedules for you will appear here.</EmptyState>
        )}
        <div className="list">
          {meetings.data?.map((m) => (
            <div key={m.id} className="item-card">
              <div>
                <h3>{m.title}</h3>
                <p className="muted small">{m.society_name} · {formatPKT(m.starts_at)} · {m.location || 'No location'}</p>
                {m.agenda && <p className="small">Agenda: {m.agenda}</p>}
              </div>
              <div className="row">
                {m.status === 'cancelled' ? (
                  <StatusBadge value="cancelled" />
                ) : m.response === 'invited' ? (
                  <>
                    <button className="btn btn-primary btn-small" onClick={() => respondMeeting(m.invitation_id, true)} disabled={act.busy}>Accept</button>
                    <button className="btn btn-small" onClick={() => respondMeeting(m.invitation_id, false)} disabled={act.busy}>Decline</button>
                  </>
                ) : (
                  <StatusBadge value={m.response} />
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
