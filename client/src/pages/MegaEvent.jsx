import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, useDataChanged } from '../hooks.js';
import { formatPKT, money, labelize, TASK_STATUS_LABELS } from '../format.js';
import { Alert, EmptyState, Loading, Panel, ProgressBar, StatCard, useActions } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

// Keep in step with EXPENSE_CATEGORIES on the server.
export const SUB_EXPENSE_CATEGORIES = ['Venue', 'Food and refreshments', 'Printing and stationery', 'Equipment', 'Transport', 'Prizes', 'Marketing', 'Other'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const pktTimeOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const EMPTY_SUB = { title: '', description: '', venue: '', event_date: '', start_time: '', end_time: '', supervisor_id: '', allocated_budget: '' };

// One sub-event: details, supervisor, budget allocation, expenses and the task checklist.
function SubEventCard({ sub, students, onChanged }) {
  const detail = useApi(`/sub-events/${sub.id}`);
  const act = useActions();
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);
  const [allocation, setAllocation] = useState('');
  const [expense, setExpense] = useState({ description: '', amount: '', category: 'Other', vendor: '' });
  const [task, setTask] = useState({ title: '', description: '', priority: 'medium', due_at: '', assignee_id: '' });

  const d = detail.data;
  const reloadAll = useCallback(() => {
    detail.reload();
    onChanged();
  }, [detail.reload, onChanged]);
  useDataChanged(reloadAll);

  async function run(fn, success) {
    const result = await act.run(fn, success);
    if (result !== undefined) reloadAll();
    return result;
  }

  if (!d) return <Loading />;
  const hasBudget = d.allocated_budget !== null && d.allocated_budget !== undefined;
  const pct = hasBudget && d.allocated_budget > 0 ? Math.round((d.spent / d.allocated_budget) * 100) : 0;

  function startEdit() {
    setEdit({
      title: d.title,
      description: d.description,
      venue: d.venue,
      event_date: d.event_date,
      start_time: pktTimeOf(d.start_at),
      end_time: pktTimeOf(d.end_at),
      supervisor_id: d.supervisor_id ?? '',
    });
    setEditing(true);
  }

  return (
    <article className="card sub-card">
      <header className="sub-head">
        <div>
          <p className="eyebrow">{d.event_date} · {pktTimeOf(d.start_at)}–{pktTimeOf(d.end_at)} · {d.venue}</p>
          <h3>{d.title}</h3>
          <p className="muted small">{d.description}</p>
        </div>
        <div className="row">
          <label className="inline small">
            Supervisor
            <select
              value={d.supervisor_id ?? ''}
              disabled={act.busy}
              onChange={(e) => run(() => api(`/sub-events/${sub.id}`, { method: 'PATCH', body: { supervisor_id: e.target.value ? Number(e.target.value) : null } }), 'Supervisor updated.')}
              aria-label={`Supervisor for ${d.title}`}
            >
              <option value="">Unassigned</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button className="btn btn-small" onClick={startEdit}>Edit details</button>
        </div>
      </header>

      {editing && edit && (
        <form
          className="inset form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { ...edit, supervisor_id: edit.supervisor_id ? Number(edit.supervisor_id) : null };
            const result = await run(() => api(`/sub-events/${sub.id}`, { method: 'PATCH', body }), 'Sub-event updated.');
            if (result !== undefined) setEditing(false);
          }}
        >
          <label>Title<input required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
          <label>Venue<input required value={edit.venue} onChange={(e) => setEdit({ ...edit, venue: e.target.value })} /></label>
          <label className="span-2">Description<textarea rows={2} required value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          <label>Date<input type="date" required value={edit.event_date} onChange={(e) => setEdit({ ...edit, event_date: e.target.value })} /></label>
          <label>Start<input type="time" required value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></label>
          <label>End<input type="time" required value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></label>
          <div className="span-2 form-actions">
            <button className="btn btn-primary" type="submit" disabled={act.busy}>Save details</button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}

      <Alert>{act.error}</Alert>

      <section className="budget-strip">
        {hasBudget ? (
          <>
            <div className="budget-figures">
              <span><span className="muted small">Allocated</span> <strong>{money(d.allocated_budget)}</strong></span>
              <span><span className="muted small">Spent</span> <strong>{money(d.spent)}</strong></span>
              <span><span className="muted small">Remaining</span> <strong className={d.remaining < 0 ? 'negative' : ''}>{money(d.remaining)}</strong></span>
            </div>
            <ProgressBar value={Math.min(pct, 100)} />
            {d.warned_80 && <p className="muted small">Spending has reached 80% of this allocation.</p>}
          </>
        ) : (
          <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api(`/sub-events/${sub.id}/allocation`, { method: 'POST', body: { amount: Number(allocation) } }), 'Allocation set.'); }}>
            <span className="muted small">No budget allocated yet.</span>
            <input type="number" min="0" step="0.01" required value={allocation} onChange={(e) => setAllocation(e.target.value)} placeholder="Allocation (PKR)" aria-label="Budget allocation" />
            <button className="btn btn-primary btn-small" type="submit" disabled={act.busy}>Set allocation</button>
            <span className="muted small">Set once. Cannot exceed the Mega Event budget.</span>
          </form>
        )}
      </section>

      <div className="split sub-split">
        <div>
          <h4 className="sub-title">Checklist</h4>
          {d.tasks.length === 0 && <p className="muted small">No preparation tasks yet.</p>}
          <ul className="checklist">
            {d.tasks.map((t) => (
              <li key={t.id} className={`check-item status-${t.status}`}>
                <div className="check-main">
                  <strong>{t.title}</strong>
                  <span className="muted small">
                    {t.assignee_name ? `Assigned to ${t.assignee_name}` : 'Unassigned'}
                    {t.due_at ? ` · Due ${formatPKT(t.due_at)}` : ''} · {labelize(t.priority)}
                  </span>
                </div>
                <div className="row">
                  <select value={t.status} disabled={act.busy} onChange={(e) => run(() => api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: e.target.value } }), 'Task updated.')} aria-label={`Status of ${t.title}`}>
                    {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button className="btn btn-small btn-ghost" onClick={() => window.confirm(`Delete "${t.title}"?`) && run(() => api(`/tasks/${t.id}`, { method: 'DELETE' }), 'Task deleted.')} disabled={act.busy}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
          <form className="inset stack" onSubmit={(e) => { e.preventDefault(); run(() => api(`/sub-events/${sub.id}/tasks`, { method: 'POST', body: { ...task, assignee_id: task.assignee_id ? Number(task.assignee_id) : null, due_at: task.due_at || null } }), 'Task added.').then((r) => r !== undefined && setTask({ title: '', description: '', priority: 'medium', due_at: '', assignee_id: '' })); }}>
            <input required placeholder="New checklist item" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} aria-label="Task title" />
            <div className="row">
              <select value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })} aria-label="Priority">
                {PRIORITIES.map((p) => <option key={p} value={p}>{labelize(p)}</option>)}
              </select>
              <input type="datetime-local" value={task.due_at} onChange={(e) => setTask({ ...task, due_at: e.target.value })} aria-label="Due date" />
              <select value={task.assignee_id} onChange={(e) => setTask({ ...task, assignee_id: e.target.value })} aria-label="Assignee">
                <option value="">Unassigned</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn btn-small btn-primary" type="submit" disabled={act.busy}>Add</button>
            </div>
          </form>
        </div>

        {hasBudget && (
          <div>
            <h4 className="sub-title">Expenses</h4>
            {d.expenses?.length === 0 && <p className="muted small">No expenses recorded.</p>}
            <ul className="plain">
              {d.expenses?.map((x) => (
                <li key={x.id} className="row-card">
                  <span>{x.description} <span className="muted small">{x.category}{x.vendor ? ` · ${x.vendor}` : ''}</span></span>
                  <strong>{money(x.amount)}</strong>
                </li>
              ))}
            </ul>
            <form className="inset stack" onSubmit={(e) => { e.preventDefault(); run(() => api(`/sub-events/${sub.id}/expenses`, { method: 'POST', body: { ...expense, amount: Number(expense.amount) } }), 'Expense recorded.').then((r) => r !== undefined && setExpense({ description: '', amount: '', category: 'Other', vendor: '' })); }}>
              <input required placeholder="What was bought" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} aria-label="Expense description" />
              <div className="row">
                <input type="number" min="0.01" step="0.01" required placeholder="Amount" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} aria-label="Amount" />
                <select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} aria-label="Category">
                  {SUB_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input placeholder="Vendor (optional)" value={expense.vendor} onChange={(e) => setExpense({ ...expense, vendor: e.target.value })} aria-label="Vendor" />
                <button className="btn btn-small btn-primary" type="submit" disabled={act.busy}>Record</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </article>
  );
}

export default function MegaEventPage() {
  const { id } = useParams();
  const mega = useApi(`/mega-events/${id}`);
  const students = useApi('/students/directory');
  const act = useActions();
  const [form, setForm] = useState(EMPTY_SUB);
  const [showForm, setShowForm] = useState(false);

  const reloadAll = useCallback(() => {
    mega.reload();
  }, [mega.reload]);
  useDataChanged(reloadAll);

  if (mega.error) return <Alert>{mega.error}</Alert>;
  if (!mega.data) return <Loading />;
  const m = mega.data;
  const studentList = students.data ?? [];

  async function createSub(e) {
    e.preventDefault();
    const body = {
      ...form,
      supervisor_id: form.supervisor_id ? Number(form.supervisor_id) : null,
      allocated_budget: form.allocated_budget === '' ? null : Number(form.allocated_budget),
    };
    const result = await act.run(() => api(`/mega-events/${m.id}/sub-events`, { method: 'POST', body }), 'Sub-event created.');
    if (result !== undefined) {
      setForm(EMPTY_SUB);
      setShowForm(false);
      reloadAll();
    }
  }

  return (
    <>
      <header className="dash-hero">
        <div className="dash-hero-text">
          <p className="eyebrow">Mega Event · {m.society_name}</p>
          <h1>{m.title}</h1>
          <p className="dash-sub">{m.start_date} to {m.end_date} · {m.description || 'No description.'}</p>
        </div>
        <div className="dash-hero-actions">
          <Link className="btn" to="/president">Back to dashboard</Link>
        </div>
      </header>

      <section className="stats-grid">
        <StatCard icon="wallet" label="Overall budget" value={money(m.overall_budget)} tone="indigo" />
        <StatCard icon="layers" label="Allocated" value={money(m.allocated)} hint={`${money(m.unallocated)} unallocated`} tone="cyan" />
        <StatCard icon="activity" label="Spent" value={money(m.spent)} hint={`${money(m.remaining)} remaining`} tone="amber" />
        <StatCard icon="check" label="Task progress" value={`${m.progress}%`} hint={`${m.task_done} of ${m.task_total} tasks done`} tone="emerald" />
      </section>

      <Alert>{act.error}</Alert>
      <Alert kind="success">{act.message}</Alert>

      <Panel
        title="Sub-events"
        count={m.sub_events?.length ?? 0}
        action={<button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Icon name="plus" size={16} />{showForm ? 'Close' : 'New sub-event'}</button>}
      >
        {showForm && (
          <form className="inset form-grid" onSubmit={createSub}>
            <label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Venue<input required value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
            <label className="span-2">Description<textarea rows={2} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>Date (within {m.start_date} to {m.end_date})<input type="date" required min={m.start_date} max={m.end_date} value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label>
            <label>Start time (PKT)<input type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></label>
            <label>End time (PKT)<input type="time" required value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></label>
            <label>Supervisor
              <select value={form.supervisor_id} onChange={(e) => setForm({ ...form, supervisor_id: e.target.value })}>
                <option value="">Choose later</option>
                {studentList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Budget allocation (PKR, optional)<input type="number" min="0" step="0.01" value={form.allocated_budget} onChange={(e) => setForm({ ...form, allocated_budget: e.target.value })} /></label>
            <div className="span-2 form-actions">
              <button className="btn btn-primary" type="submit" disabled={act.busy}>Create sub-event</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {m.sub_events?.length === 0 && !showForm && (
          <EmptyState icon="calendar" title="No sub-events yet">Add sub-events such as a competition, workshop or exhibition.</EmptyState>
        )}
        <div className="stack sub-list">
          {m.sub_events?.map((s) => <SubEventCard key={s.id} sub={s} students={studentList} onChanged={reloadAll} />)}
        </div>
      </Panel>
    </>
  );
}
