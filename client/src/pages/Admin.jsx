import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { useApi, useDataChanged } from '../hooks.js';
import { formatPKT, money, STATUS_LABELS } from '../format.js';
import { Alert, DashHero, EmptyState, Loading, Panel, ProgressBar, ScheduleBadge, StatCard, StatusBadge, useActions } from '../components/ui.jsx';

const EVENT_FILTERS = ['', 'pending', 'approved', 'rejected', 'draft', 'cancelled'];
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrator' },
  { value: 'president', label: 'President' },
  { value: 'student', label: 'Student' },
];

export default function AdminDashboard() {
  const dash = useApi('/admin/dashboard');
  const [filter, setFilter] = useState('');
  const monitor = useApi(`/admin/events${filter ? `?status=${filter}` : ''}`);
  const societies = useApi('/admin/societies');
  const users = useApi('/admin/users');
  const [roleFilter, setRoleFilter] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const act = useActions();
  const [remarks, setRemarks] = useState({});
  const [budgets, setBudgets] = useState({});

  const reloadAll = useCallback(() => {
    dash.reload();
    monitor.reload();
    societies.reload();
    users.reload();
  }, [dash.reload, monitor.reload, societies.reload, users.reload]);
  useDataChanged(reloadAll);

  async function decide(ev, decision) {
    const body = { decision, remarks: remarks[ev.id] ?? '' };
    if (decision === 'approve') {
      const entered = budgets[ev.id];
      // Blank means "approve the proposed budget".
      if (entered !== undefined && entered !== '') body.approved_budget = Number(entered);
    }
    const result = await act.run(
      () => api(`/admin/events/${ev.id}/decision`, { method: 'POST', body }),
      decision === 'approve' ? `Approved "${ev.title}".` : `Rejected "${ev.title}".`,
    );
    if (result !== undefined) reloadAll();
  }

  async function saveUser(e) {
    e.preventDefault();
    const { id, name, email, role } = editingUser;
    const result = await act.run(
      () => api(`/admin/users/${id}`, { method: 'PATCH', body: { name, email, role } }),
      'User updated.',
    );
    if (result !== undefined) {
      setEditingUser(null);
      reloadAll();
    }
  }

  const stats = dash.data?.stats;

  return (
    <>
      <DashHero
        eyebrow="Administration"
        title="University administration"
        subtitle="Review event proposals and budgets, and monitor activity across all societies."
      />

      <Alert>{act.error}</Alert>
      <Alert kind="success">{act.message}</Alert>

      {dash.error && <Alert>{dash.error}</Alert>}
      {!stats && !dash.error && <Loading />}
      {stats && (
        <section className="stats-grid">
          <StatCard icon="building" label="Societies" value={stats.societies} tone="indigo" />
          <StatCard icon="calendar" label="Events" value={stats.events} tone="cyan" />
          <StatCard icon="ticket" label="Active registrations" value={stats.registrations} tone="violet" />
          <StatCard icon="clock" label="Pending proposals" value={stats.pending} hint="Needs a decision" tone="amber" />
          <StatCard icon="activity" label="Live approved events" value={stats.approved} hint="Upcoming or ongoing" tone="emerald" />
        </section>
      )}

      <Panel title="Event proposals awaiting decision" count={dash.data?.pending.length ?? 0}>
        <p className="muted small panel-note">
          Drafts and submitted proposals appear here. Approve confirms the event and its proposed budget together. Rejection requires remarks.
        </p>
        {dash.data?.pending.length === 0 && (
          <EmptyState icon="check" title="Nothing to decide">Drafts and submitted proposals from societies will appear here.</EmptyState>
        )}
        <div className="list">
          {dash.data?.pending.map((ev) => {
            const started = ev.schedule_status !== 'upcoming';
            const overspent = ev.spent > ev.proposed_budget;
            return (
              <div key={ev.id} className="proposal">
                <div className="proposal-head">
                  <div>
                    <h3>{ev.title}</h3>
                    <p className="muted small">{ev.society_name} · {ev.venue} · {formatPKT(ev.start_at)} → {formatPKT(ev.end_at)}</p>
                  </div>
                  <div className="row">
                    <ScheduleBadge value={ev.schedule_status} />
                    <StatusBadge value={ev.status} />
                  </div>
                </div>
                <div className="proposal-facts">
                  <span><span className="muted">Proposed budget</span> <strong>{money(ev.proposed_budget)}</strong></span>
                  <span><span className="muted">Capacity</span> <strong>{ev.capacity}</strong></span>
                  <span><span className="muted">Registered</span> <strong>{ev.registered_count}</strong></span>
                  {ev.approved_budget !== null && (
                    <span><span className="muted">Last approved</span> <strong>{money(ev.approved_budget)}</strong></span>
                  )}
                </div>
                {overspent && (
                  <Alert kind="info">
                    Warning: recorded spending ({money(ev.spent)}) is more than the proposed budget. Approving would leave the event over budget.
                  </Alert>
                )}
                {started && (
                  <Alert kind="info">The start time has passed. This proposal can only be rejected.</Alert>
                )}
                <div className="row decision">
                  <label className="budget-input">
                    Approved budget (PKR)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={String(ev.proposed_budget)}
                      value={budgets[ev.id] ?? ''}
                      onChange={(e) => setBudgets({ ...budgets, [ev.id]: e.target.value })}
                      aria-label={`Approved budget for ${ev.title}`}
                    />
                  </label>
                  <input
                    className="grow"
                    placeholder="Remarks (required to reject)"
                    value={remarks[ev.id] ?? ''}
                    onChange={(e) => setRemarks({ ...remarks, [ev.id]: e.target.value })}
                    aria-label={`Remarks for ${ev.title}`}
                  />
                  <button className="btn btn-primary" onClick={() => decide(ev, 'approve')} disabled={started || act.busy}>Approve</button>
                  <button className="btn btn-danger" onClick={() => decide(ev, 'reject')} disabled={act.busy}>Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Event monitor"
        action={
          <label className="inline">
            Approval status
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {EVENT_FILTERS.map((f) => <option key={f} value={f}>{f ? STATUS_LABELS[f] : 'All'}</option>)}
            </select>
          </label>
        }
      >
        <Alert>{monitor.error}</Alert>
        {monitor.data?.length === 0 && <EmptyState icon="calendar" title="No events match">Try a different approval status.</EmptyState>}
        {monitor.data?.length > 0 && (
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Society</th>
                  <th>Approval</th>
                  <th>Schedule</th>
                  <th>Registered</th>
                  <th>Task progress</th>
                  <th>Approved budget</th>
                  <th>Spent</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {monitor.data?.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.title}</td>
                    <td>{ev.society_name}</td>
                    <td><StatusBadge value={ev.status} /></td>
                    <td><ScheduleBadge value={ev.schedule_status} /></td>
                    <td>{ev.registered_count} / {ev.capacity}</td>
                    <td className="progress-cell"><ProgressBar value={ev.progress} /></td>
                    <td>{money(ev.approved_budget)}</td>
                    <td>{money(ev.spent)}</td>
                    <td className={ev.budget_remaining < 0 ? 'negative' : ''}>
                      {ev.budget_remaining === null ? '—' : money(ev.budget_remaining)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Users & roles" count={users.data?.length ?? 0}>
        <div className="role-summary">
          {ROLE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`role-chip ${roleFilter === value ? 'active' : ''}`}
              onClick={() => setRoleFilter(roleFilter === value ? '' : value)}
            >
              <span className={`badge badge-${value}`}>{label}</span>
              <strong>{users.data?.filter((u) => u.role === value).length ?? 0}</strong>
            </button>
          ))}
        </div>
        <p className="muted small panel-note">Edit a user to change their name, email or role. You cannot remove your own administrator role.</p>
        <Alert>{users.error}</Alert>
        {users.data?.length === 0 && <EmptyState icon="users" title="No users yet">Accounts appear here once people sign up.</EmptyState>}
        {users.data?.length > 0 && (
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr>
              </thead>
              <tbody>
                {users.data
                  .filter((u) => !roleFilter || u.role === roleFilter)
                  .map((u) =>
                    editingUser?.id === u.id ? (
                      <tr key={u.id}>
                        <td colSpan={5}>
                          <form className="form-grid" onSubmit={saveUser}>
                            <input required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} aria-label="Name" />
                            <input type="email" required value={editingUser.email} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} aria-label="Email" />
                            <select value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })} aria-label="Role">
                              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            <div className="form-actions">
                              <button className="btn btn-primary btn-small" type="submit" disabled={act.busy}>Save</button>
                              <button className="btn btn-small" type="button" onClick={() => setEditingUser(null)}>Cancel</button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.email}</td>
                        <td><span className={`badge badge-${u.role}`}>{ROLE_OPTIONS.find((r) => r.value === u.role)?.label ?? u.role}</span></td>
                        <td>{formatPKT(u.created_at)}</td>
                        <td>
                          <button className="btn btn-small" onClick={() => setEditingUser({ id: u.id, name: u.name, email: u.email, role: u.role })} disabled={act.busy}>Edit</button>
                        </td>
                      </tr>
                    ),
                  )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Societies" count={societies.data?.length ?? 0}>
        {societies.data?.length === 0 && <EmptyState icon="building" title="No societies yet">Societies appear here once a president creates one.</EmptyState>}
        {societies.data?.length > 0 && (
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr><th>Society</th><th>Category</th><th>President</th><th>Members</th><th>Events</th><th>Created</th></tr>
              </thead>
              <tbody>
                {societies.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.category}</td>
                    <td>{s.president_name} <span className="muted small">{s.president_email}</span></td>
                    <td>{s.members}</td>
                    <td>{s.events}</td>
                    <td>{formatPKT(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
