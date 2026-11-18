import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, useDataChanged } from '../hooks.js';
import { formatPKT, money, toPktInput } from '../format.js';
import { Alert, CopyLinkButton, CopyTextButton, DashHero, EmptyState, Loading, Panel, ScheduleBadge, StatCard, StatusBadge, useActions } from '../components/ui.jsx';
import EventForm from '../components/EventForm.jsx';

const EMPTY_SOCIETY = { name: '', description: '', category: '', contact_email: '', contact_phone: '' };

function SocietyForm({ initial, categories, onSubmit, busy, submitLabel, onCancel }) {
  const [v, setV] = useState({ ...EMPTY_SOCIETY, category: categories[0] ?? '', ...initial });
  const set = (key) => (e) => setV((s) => ({ ...s, [key]: e.target.value }));

  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label>
        Society name
        <input required maxLength={100} value={v.name} onChange={set('name')} />
      </label>
      <label>
        Category
        <select required value={v.category} onChange={set('category')}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="span-2">
        Description
        <textarea rows={3} value={v.description} onChange={set('description')} />
      </label>
      <label>
        Contact email
        <input type="email" value={v.contact_email} onChange={set('contact_email')} />
      </label>
      <label>
        Contact phone
        <input value={v.contact_phone} onChange={set('contact_phone')} />
      </label>
      <div className="span-2 form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>{submitLabel}</button>
        {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export default function PresidentDashboard() {
  // A president can own several societies. The selected one drives everything on this page.
  const mine = useApi('/societies/mine');
  const [chosenId, setChosenId] = useState(null);
  const [creatingSociety, setCreatingSociety] = useState(false);
  const selected = mine.data?.find((s) => s.id === chosenId) ?? mine.data?.[0] ?? null;
  const society = { data: selected, loading: mine.loading, error: mine.error, reload: mine.reload };

  const categories = useApi('/societies/categories');
  const members = useApi(`/societies/${selected?.id}/memberships`, { enabled: Boolean(selected) });
  const allEvents = useApi('/events/mine');
  const meetings = useApi(`/societies/${selected?.id}/meetings`, { enabled: Boolean(selected) });
  // null when hidden; otherwise the meeting being created (no id) or edited (id).
  const [meetingForm, setMeetingForm] = useState(null);
  // Events shown here belong to the selected society only.
  const events = { ...allEvents, data: allEvents.data?.filter((ev) => ev.society_id === selected?.id) };
  const act = useActions();
  const [editingSociety, setEditingSociety] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');

  const reloadAll = useCallback(() => {
    mine.reload();
    members.reload();
    allEvents.reload();
    meetings.reload();
  }, [mine.reload, members.reload, allEvents.reload, meetings.reload]);
  useDataChanged(reloadAll);

  async function createSociety(values) {
    const result = await act.run(() => api('/societies', { method: 'POST', body: values }), 'Society created.');
    if (result !== undefined) {
      setChosenId(result.id);
      setCreatingSociety(false);
      reloadAll();
    }
  }

  async function updateSociety(values) {
    const result = await act.run(() => api(`/societies/${society.data.id}`, { method: 'PUT', body: values }), 'Society profile saved.');
    if (result !== undefined) {
      setEditingSociety(false);
      reloadAll();
    }
  }

  async function decideMembership(membershipId, action) {
    const result = await act.run(
      () => api(`/societies/${society.data.id}/memberships/${membershipId}`, { method: 'PATCH', body: { action } }),
      'Membership updated.',
    );
    if (result !== undefined) reloadAll();
  }

  async function setLabel(membershipId, label) {
    const result = await act.run(
      () => api(`/societies/${selected.id}/memberships/${membershipId}`, { method: 'PATCH', body: { action: 'label', label } }),
      'Label updated.',
    );
    if (result !== undefined) reloadAll();
  }

  function toggleInvitee(studentId) {
    setMeetingForm((f) => ({
      ...f,
      student_ids: f.student_ids.includes(studentId) ? f.student_ids.filter((x) => x !== studentId) : [...f.student_ids, studentId],
    }));
  }

  async function saveMeeting(e) {
    e.preventDefault();
    const { id: meetingId, student_ids, ...fields } = meetingForm;
    const result = meetingId
      ? await act.run(() => api(`/meetings/${meetingId}`, { method: 'PATCH', body: fields }), 'Meeting updated.')
      : await act.run(
        () => api(`/societies/${selected.id}/meetings`, { method: 'POST', body: { ...fields, student_ids } }),
        'Meeting created and invitations sent.',
      );
    if (result !== undefined) {
      setMeetingForm(null);
      reloadAll();
    }
  }

  async function cancelMeeting(m) {
    if (!window.confirm(`Cancel "${m.title}"? Invited members will be notified.`)) return;
    const result = await act.run(() => api(`/meetings/${m.id}/cancel`, { method: 'POST' }), 'Meeting cancelled.');
    if (result !== undefined) reloadAll();
  }

  async function createEvent(values) {
    const result = await act.run(
      () => api('/events', { method: 'POST', body: { ...values, society_id: selected.id } }),
      'Event created as a draft. Submit it when ready.',
    );
    if (result !== undefined) {
      setCreatingEvent(false);
      reloadAll();
    }
  }

  if (society.loading && !society.data && !society.error) return <Loading />;
  if (society.error) return <Alert>{society.error}</Alert>;

  // No society yet, or the president is adding another one.
  if (!society.data || creatingSociety) {
    return (
      <div className="card narrow">
        <h1>{society.data ? 'Create another society' : 'Create your society'}</h1>
        <p className="muted">Your society becomes active immediately. You can then add events and invite volunteers.</p>
        <Alert>{act.error}</Alert>
        <SocietyForm
          categories={categories.data ?? []}
          onSubmit={createSociety}
          busy={act.busy}
          submitLabel="Create society"
          onCancel={society.data ? () => setCreatingSociety(false) : undefined}
        />
      </div>
    );
  }

  const s = society.data;
  const pendingRequests = members.data?.filter((m) => m.status === 'pending') ?? [];
  const activeMembers = members.data?.filter((m) => m.status === 'approved') ?? [];
  const memberSearch = memberQuery.trim().toLowerCase();
  const visibleMembers = memberSearch
    ? activeMembers.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(memberSearch))
    : activeMembers;

  return (
    <>
      <DashHero
        eyebrow={s.category}
        title={s.name}
        subtitle={<>{s.member_count} member(s) · <Link to={`/societies/${s.id}`}>View public page</Link></>}
        actions={
          <>
            {mine.data?.length > 1 && (
              <select
                value={s.id}
                aria-label="Choose society"
                onChange={(e) => {
                  setChosenId(Number(e.target.value));
                  setEditingSociety(false);
                }}
              >
                {mine.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
            <button className="btn" onClick={() => setCreatingSociety(true)}>New society</button>
            <a className="btn btn-primary" href="#events">Manage events</a>
            <button className="btn" onClick={() => setEditingSociety((v) => !v)}>
              {editingSociety ? 'Close' : 'Edit society'}
            </button>
          </>
        }
      />

      <section className="stats-grid">
        <StatCard icon="users" label="Members" value={activeMembers.length} hint="Approved" tone="indigo" />
        <StatCard icon="inbox" label="Requests" value={pendingRequests.length} hint="Waiting for review" tone="amber" />
        <StatCard icon="calendar" label="Events" value={events.data?.length ?? 0} hint="All statuses" tone="cyan" />
        <StatCard
          icon="wallet"
          label="Budget spent"
          value={money(events.data?.reduce((sum, ev) => sum + (ev.spent ?? 0), 0) ?? 0)}
          hint="Across all events"
          tone="violet"
        />
      </section>

      <Alert>{act.error}</Alert>
      <Alert kind="success">{act.message}</Alert>

      <Panel title="Share your events" className="share-panel">
        <p className="muted small panel-note">
          Anyone with this link can see your society's upcoming events and open an event to register. Logging in is needed only to register.
        </p>
        <div className="share-row">
          <input readOnly value={`${window.location.origin}/events?society=${s.id}`} aria-label="Public events link" onFocus={(e) => e.target.select()} />
          <CopyTextButton text={`${window.location.origin}/events?society=${s.id}`} />
          <a className="btn" href={`/events?society=${s.id}`} target="_blank" rel="noreferrer">Open</a>
        </div>
      </Panel>

      {editingSociety && (
        <Panel title="Society profile">
          <div className="panel-pad">
          <SocietyForm
            initial={{ name: s.name, description: s.description, category: s.category, contact_email: s.contact_email, contact_phone: s.contact_phone }}
            categories={categories.data ?? []}
            onSubmit={updateSociety}
            busy={act.busy}
            submitLabel="Save profile"
            onCancel={() => setEditingSociety(false)}
          />
          </div>
        </Panel>
      )}

      <div className="dash-grid">
        <Panel title="Membership requests" count={pendingRequests.length}>
          {pendingRequests.length === 0 && (
            <EmptyState icon="check" title="All caught up">No pending membership requests.</EmptyState>
          )}
          <ul className="plain">
            {pendingRequests.map((m) => (
              <li key={m.id} className="row-card">
                <span className="person">
                  <span className="avatar">{m.name.charAt(0)}</span>
                  <span>{m.name} <span className="muted small">{m.email}</span></span>
                </span>
                <span className="row">
                  <button className="btn btn-small btn-primary" onClick={() => decideMembership(m.id, 'approve')} disabled={act.busy}>Approve</button>
                  <button className="btn btn-small" onClick={() => decideMembership(m.id, 'reject')} disabled={act.busy}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Members"
          count={visibleMembers.length}
          action={
            <input
              className="search-input"
              type="search"
              placeholder="Search name or email"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              aria-label="Search members"
            />
          }
        >
          {activeMembers.length === 0 && <EmptyState icon="users" title="No members yet">Approved members appear here.</EmptyState>}
          {activeMembers.length > 0 && visibleMembers.length === 0 && <EmptyState icon="users" title="No matching members">Try a different search.</EmptyState>}
          <ul className="plain">
            {visibleMembers.map((m) => (
              <li key={m.id} className="row-card">
                <span className="person">
                  <span className="avatar">{m.name.charAt(0)}</span>
                  <span>{m.name} <span className="muted small">{m.email}</span></span>
                </span>
                <span className="row">
                  <select
                    value={m.label ?? 'member'}
                    onChange={(e) => setLabel(m.id, e.target.value)}
                    disabled={act.busy}
                    aria-label={`Label for ${m.name}`}
                  >
                    <option value="member">Member</option>
                    <option value="core">Core Member</option>
                  </select>
                  <button className="btn btn-small" onClick={() => decideMembership(m.id, 'remove')} disabled={act.busy}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div id="events" className="scroll-anchor" />
      <Panel
        title="Events"
        count={events.data?.length ?? 0}
        action={
          <button className="btn btn-primary" onClick={() => setCreatingEvent((v) => !v)}>
            {creatingEvent ? 'Close' : 'New event'}
          </button>
        }
      >
        {creatingEvent && (
          <div className="inset">
            <h3>New event</h3>
            <p className="muted small">Times are entered in Pakistan Standard Time (PKT).</p>
            <EventForm onSubmit={createEvent} busy={act.busy} submitLabel="Create draft" onCancel={() => setCreatingEvent(false)} />
          </div>
        )}

        <Alert>{events.error}</Alert>
        {events.data?.length === 0 && (
          <EmptyState icon="calendar" title="No events yet">Create an event and submit it for approval to publish it.</EmptyState>
        )}
        {events.data?.length > 0 && (
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Approval</th>
                  <th>Schedule</th>
                  <th>Starts</th>
                  <th>Registered</th>
                  <th>Budget (approved / proposed)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <Link to={`/president/events/${ev.id}`}>{ev.title}</Link>
                      {ev.remarks && <div className="muted small">Admin: {ev.remarks}</div>}
                    </td>
                    <td><StatusBadge value={ev.status} /></td>
                    <td><ScheduleBadge value={ev.schedule_status} /></td>
                    <td>{formatPKT(ev.start_at)}</td>
                    <td>{ev.registered_count} / {ev.capacity}</td>
                    <td>{money(ev.approved_budget)} / {money(ev.proposed_budget)}</td>
                    <td className="row">
                      <Link className="btn btn-small btn-primary" to={`/president/events/${ev.id}`}>Manage</Link>
                      <CopyLinkButton eventId={ev.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Meetings"
        count={meetings.data?.length ?? 0}
        action={
          <button
            className="btn btn-primary"
            onClick={() => setMeetingForm(meetingForm ? null : { title: '', starts_at: '', location: '', agenda: '', student_ids: [] })}
          >
            {meetingForm ? 'Close' : 'New meeting'}
          </button>
        }
      >
        {meetingForm && (
          <form className="inset form-grid" onSubmit={saveMeeting}>
            <label>
              Title
              <input required value={meetingForm.title} onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })} />
            </label>
            <label>
              Date and time (PKT)
              <input type="datetime-local" required value={meetingForm.starts_at} onChange={(e) => setMeetingForm({ ...meetingForm, starts_at: e.target.value })} />
            </label>
            <label>
              Location
              <input value={meetingForm.location} onChange={(e) => setMeetingForm({ ...meetingForm, location: e.target.value })} />
            </label>
            <label className="span-2">
              Agenda
              <textarea rows={3} value={meetingForm.agenda} onChange={(e) => setMeetingForm({ ...meetingForm, agenda: e.target.value })} />
            </label>
            {!meetingForm.id && (
              <fieldset className="span-2 invitee-list">
                <legend>Invite approved members</legend>
                {activeMembers.length === 0 && <p className="muted small">No approved members to invite yet.</p>}
                {activeMembers.map((m) => (
                  <label key={m.student_id} className="radio">
                    <input
                      type="checkbox"
                      checked={meetingForm.student_ids.includes(m.student_id)}
                      onChange={() => toggleInvitee(m.student_id)}
                    />
                    {m.name}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="span-2 form-actions">
              <button className="btn btn-primary" type="submit" disabled={act.busy}>
                {meetingForm.id ? 'Save meeting' : 'Create meeting and invite'}
              </button>
              <button className="btn" type="button" onClick={() => setMeetingForm(null)}>Cancel</button>
            </div>
          </form>
        )}

        {meetings.error && <Alert>{meetings.error}</Alert>}
        {meetings.data?.length === 0 && !meetingForm && (
          <EmptyState icon="calendar" title="No meetings yet">Schedule a meeting and invite approved members.</EmptyState>
        )}
        <div className="list">
          {meetings.data?.map((m) => (
            <div key={m.id} className="item-card">
              <div>
                <h3>{m.title}</h3>
                <p className="muted small">
                  {formatPKT(m.starts_at)} · {m.location || 'No location'} · {m.accepted_count} of {m.invited_count} accepted
                </p>
                {m.agenda && <p className="small">{m.agenda}</p>}
              </div>
              <div className="row">
                <StatusBadge value={m.status} />
                {m.status === 'scheduled' && (
                  <>
                    <button
                      className="btn btn-small"
                      onClick={() => setMeetingForm({ id: m.id, title: m.title, starts_at: toPktInput(m.starts_at), location: m.location, agenda: m.agenda, student_ids: [] })}
                    >
                      Edit
                    </button>
                    <button className="btn btn-small btn-danger" onClick={() => cancelMeeting(m)} disabled={act.busy}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
