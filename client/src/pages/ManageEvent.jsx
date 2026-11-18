import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadExpenseReport, openReceipt } from '../api.js';

// Expense categories. Keep in step with EXPENSE_CATEGORIES on the server.
const EXPENSE_CATEGORIES = ['Venue', 'Food and refreshments', 'Printing and stationery', 'Equipment', 'Transport', 'Prizes', 'Marketing', 'Other'];
import { useApi, useDataChanged, useEventRoom } from '../hooks.js';
import { formatPKT, labelize, money, TASK_STATUS_LABELS, nowPktInput } from '../format.js';
import { Alert, CopyLinkButton, Empty, Loading, ProgressBar, ScheduleBadge, StatusBadge, useActions } from '../components/ui.jsx';
import EventForm from '../components/EventForm.jsx';

const TASK_COLUMNS = ['todo', 'in_progress', 'completed'];
const EMPTY_TASK = { title: '', description: '', priority: 'medium', due_at: '' };
const EMPTY_EXPENSE = { description: '', amount: '', spent_on: '', category: 'Other', vendor: '' };

export default function ManageEvent() {
  const { id } = useParams();
  const evQ = useApi(`/events/${id}`);
  const regQ = useApi(`/events/${id}/registrations`);
  const invQ = useApi(`/events/${id}/invitations`);
  const candQ = useApi(`/events/${id}/invite-candidates`);
  const taskQ = useApi(`/events/${id}/tasks`);
  const expQ = useApi(`/events/${id}/expenses`);
  const act = useActions();

  const [inviteId, setInviteId] = useState('');
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE);
  const [editingExpense, setEditingExpense] = useState(null);
  const [taskFilter, setTaskFilter] = useState('all');
  const [expQuery, setExpQuery] = useState('');
  const [expCategory, setExpCategory] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptKey, setReceiptKey] = useState(0);
  const [editReceipt, setEditReceipt] = useState(null);
  const [editing, setEditing] = useState(false);

  const reloadAll = useCallback(() => {
    evQ.reload();
    regQ.reload();
    invQ.reload();
    candQ.reload();
    taskQ.reload();
    expQ.reload();
  }, [evQ.reload, regQ.reload, invQ.reload, candQ.reload, taskQ.reload, expQ.reload]);

  // Live updates: registrations, volunteer responses, task moves and expenses from any user.
  useDataChanged(reloadAll);
  useEventRoom(id, reloadAll);

  if (evQ.error) return <Alert>{evQ.error}</Alert>;
  if (!evQ.data) return <Loading />;

  const ev = evQ.data;
  const volunteers = (invQ.data ?? []).filter((i) => i.status === 'accepted');
  const pendingInvites = (invQ.data ?? []).filter((i) => i.status === 'invited');
  const tasks = taskQ.data?.tasks ?? [];
  const now = Date.now();
  const isOverdue = (t) => t.status !== 'completed' && Date.parse(t.due_at) < now;
  const visibleTasks = tasks.filter((t) => {
    if (taskFilter === 'overdue') return isOverdue(t);
    if (taskFilter === 'unassigned') return !t.assignee_id;
    if (taskFilter === 'completed') return t.status === 'completed';
    if (taskFilter === 'urgent') return t.priority === 'urgent';
    return true;
  });
  const expenses = expQ.data?.expenses ?? [];
  const expSearch = expQuery.trim().toLowerCase();
  const visibleExpenses = expenses.filter((x) =>
    (!expCategory || x.category === expCategory)
    && (!expSearch || `${x.description} ${x.vendor ?? ''}`.toLowerCase().includes(expSearch)),
  );
  const eventIsLive = ev.status !== 'cancelled';
  const overProposed = ev.status === 'pending' && ev.spent > ev.proposed_budget;

  async function run(fn, success) {
    const result = await act.run(fn, success);
    if (result !== undefined) reloadAll();
    return result;
  }

  async function submitEvent() {
    if (!window.confirm('Submit this event for administrator approval? You cannot edit it while it is pending.')) return;
    await run(() => api(`/events/${id}/submit`, { method: 'POST' }), 'Submitted for approval.');
  }

  async function cancelEvent() {
    if (!window.confirm('Cancel this event? This cannot be undone. Registrations will be cancelled and participants notified.')) return;
    await run(() => api(`/events/${id}/cancel`, { method: 'POST' }), 'Event cancelled.');
  }

  async function saveEvent(values) {
    const result = await run(() => api(`/events/${id}`, { method: 'PUT', body: values }), 'Event saved.');
    if (result !== undefined) setEditing(false);
  }

  async function invite() {
    if (!inviteId) return;
    const result = await run(() => api(`/events/${id}/invitations`, { method: 'POST', body: { student_id: Number(inviteId) } }), 'Invitation sent.');
    if (result !== undefined) setInviteId('');
  }

  async function createTask(e) {
    e.preventDefault();
    const result = await run(() => api(`/events/${id}/tasks`, { method: 'POST', body: taskForm }), 'Task created.');
    if (result !== undefined) setTaskForm(EMPTY_TASK);
  }

  function updateTask(taskId, body) {
    return run(() => api(`/tasks/${taskId}`, { method: 'PATCH', body }), 'Task updated.');
  }

  function deleteTask(taskId, title) {
    if (!window.confirm(`Delete the task "${title}"? This cannot be undone.`)) return undefined;
    return run(() => api(`/tasks/${taskId}`, { method: 'DELETE' }), 'Task deleted.');
  }

  // Expense fields plus an optional receipt file, sent as multipart form data.
  function expenseFormData(values, file) {
    const form = new FormData();
    form.append('description', values.description);
    form.append('amount', String(Number(values.amount)));
    if (values.spent_on) form.append('spent_on', values.spent_on);
    form.append('category', values.category || 'Other');
    form.append('vendor', values.vendor || '');
    if (file) form.append('receipt', file);
    return form;
  }

  async function addExpense(e) {
    e.preventDefault();
    const result = await run(
      () => api(`/events/${id}/expenses`, { method: 'POST', body: expenseFormData(expenseForm, receiptFile) }),
      'Expense recorded.',
    );
    if (result !== undefined) {
      setExpenseForm(EMPTY_EXPENSE);
      setReceiptFile(null);
      setReceiptKey((k) => k + 1);
    }
  }

  async function saveExpense(e) {
    e.preventDefault();
    const result = await run(
      () => api(`/expenses/${editingExpense.id}`, { method: 'PUT', body: expenseFormData(editingExpense, editReceipt) }),
      'Expense updated.',
    );
    if (result !== undefined) {
      setEditingExpense(null);
      setEditReceipt(null);
    }
  }

  async function viewReceipt(expenseId) {
    try {
      await openReceipt(expenseId);
    } catch (err) {
      act.setError(err.message);
    }
  }

  function deleteExpense(expenseId) {
    if (!window.confirm('Delete this expense record?')) return;
    return run(() => api(`/expenses/${expenseId}`, { method: 'DELETE' }), 'Expense deleted.');
  }

  return (
    <>
      <p><Link to="/president">← Back to my society</Link></p>
      <div className="page-head">
        <div>
          <div className="row">
            <StatusBadge value={ev.status} />
            <ScheduleBadge value={ev.schedule_status} />
          </div>
          <h1>{ev.title}</h1>
          <p className="muted">
            {formatPKT(ev.start_at)} → {formatPKT(ev.end_at)} · {ev.venue} · <Link to={`/events/${id}`}>Public page</Link>
          </p>
        </div>
        <div className="row">
          {ev.actions.submit && <button className="btn btn-primary" onClick={submitEvent} disabled={act.busy}>Submit for approval</button>}
          <CopyLinkButton eventId={ev.id} small={false} />
          {ev.actions.cancel && <button className="btn btn-danger" onClick={cancelEvent} disabled={act.busy}>Cancel event</button>}
        </div>
      </div>

      <nav className="quick-links" aria-label="Event sections">
        <a href="#volunteers">Volunteers</a>
        <a href="#tasks">Tasks</a>
        <a href="#expenses">Expenses</a>
        <a href="#registrations">Registrations</a>
      </nav>

      <Alert>{act.error}</Alert>
      <Alert kind="success">{act.message}</Alert>
      {ev.remarks && <Alert kind="info">Administrator remarks: {ev.remarks}</Alert>}
      {ev.status === 'pending' && ev.approved_budget !== null && (
        <Alert kind="info">Awaiting re-approval. The last approved budget of {money(ev.approved_budget)} remains in force.</Alert>
      )}
      {overProposed && (
        <Alert kind="info">
          Recorded spending ({money(ev.spent)}) is above the proposed budget. Approving this proposal would leave the event over budget.
        </Alert>
      )}

      <section className="stats">
        <div className="stat"><span>Proposed budget</span><strong>{money(ev.proposed_budget)}</strong></div>
        <div className="stat"><span>Approved budget</span><strong>{money(ev.approved_budget)}</strong></div>
        <div className="stat"><span>Spent</span><strong>{money(ev.spent)}</strong></div>
        <div className="stat"><span>Remaining</span><strong className={ev.budget_remaining < 0 ? 'negative' : ''}>
          {ev.budget_remaining === null ? '—' : money(ev.budget_remaining)}
          {ev.budget_remaining !== null && ev.budget_remaining < 0 && <span className="badge badge-rejected">Over budget</span>}
        </strong></div>
        <div className="stat"><span>Registered</span><strong>{ev.registered_count} / {ev.capacity}</strong></div>
        <div className="stat"><span>Task progress</span><strong>{ev.progress}%</strong></div>
      </section>

      <section className="card section">
        <div className="page-head">
          <h2>Event details</h2>
          {ev.actions.edit && <button className="btn" onClick={() => setEditing((v) => !v)}>{editing ? 'Close' : 'Edit'}</button>}
        </div>
        {!ev.actions.edit && eventIsLive && (
          <p className="muted small">
            Editing is locked in this state{ev.status === 'pending' ? ' while the proposal is under review' : ev.schedule_status !== 'upcoming' ? ' because the event has started' : ''}.
          </p>
        )}
        {editing && ev.actions.edit && (
          <>
            {ev.status === 'approved' && (
              <Alert kind="info">Saving changes to an approved event sends it back for administrator re-approval.</Alert>
            )}
            <EventForm initial={ev} onSubmit={saveEvent} busy={act.busy} submitLabel="Save changes" onCancel={() => setEditing(false)} />
          </>
        )}
        {!editing && <p className="pre">{ev.description || 'No description.'}</p>}
        <p className="muted small">Registration deadline: {formatPKT(ev.registration_deadline)} · Capacity {ev.capacity}</p>
      </section>

      <section className="section split">
        <div className="card" id="registrations">
          <h2>Registrations</h2>
          <p className="muted small">{ev.registered_count} active of {ev.capacity} seats</p>
          {regQ.data?.length === 0 && <Empty>No registrations yet.</Empty>}
          <ul className="plain">
            {regQ.data?.map((r) => (
              <li key={r.id} className="row-card">
                <span>{r.name} <span className="muted small">{r.email}</span></span>
                <StatusBadge value={r.status} />
              </li>
            ))}
          </ul>
        </div>

        <div className="card" id="volunteers">
          <h2>Volunteers</h2>
          {ev.actions.invite ? (
            <div className="row">
              <select value={inviteId} onChange={(e) => setInviteId(e.target.value)} aria-label="Choose a student to invite">
                <option value="">Choose a student…</option>
                {candQ.data?.filter((c) => !c.invitation_status).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.is_member ? ' (member)' : ''}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={invite} disabled={!inviteId || act.busy}>Invite</button>
            </div>
          ) : (
            <p className="muted small">Invitations are closed for this event.</p>
          )}
          {invQ.data?.length === 0 && <Empty>No invitations sent yet.</Empty>}
          <ul className="plain">
            {invQ.data?.map((i) => (
              <li key={i.id} className="row-card">
                <span>{i.name}</span>
                <StatusBadge value={i.status} />
              </li>
            ))}
          </ul>
          {pendingInvites.length > 0 && <p className="muted small">{pendingInvites.length} awaiting response.</p>}
        </div>
      </section>

      <section className="section" id="tasks">
        <div className="page-head">
          <h2>Task board</h2>
          <div className="row">
            <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} aria-label="Filter tasks">
              <option value="all">All tasks ({tasks.length})</option>
              <option value="overdue">Overdue ({tasks.filter(isOverdue).length})</option>
              <option value="unassigned">Unassigned</option>
              <option value="urgent">Urgent priority</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="progress-wrap"><ProgressBar value={ev.progress ?? taskQ.data?.progress ?? 0} /></div>
        </div>

        {eventIsLive && (
          <form className="card form-grid" onSubmit={createTask}>
            <label className="span-2">
              Task title
              <input required value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
            </label>
            <label>
              Priority
              <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label>
              Due (PKT)
              <input type="datetime-local" required value={taskForm.due_at} min={nowPktInput()} onChange={(e) => setTaskForm({ ...taskForm, due_at: e.target.value })} />
            </label>
            <label className="span-2">
              Description
              <input value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} />
            </label>
            <div className="span-2 form-actions">
              <button className="btn btn-primary" type="submit" disabled={act.busy}>Add task</button>
            </div>
          </form>
        )}

        <div className="kanban">
          {TASK_COLUMNS.map((col) => (
            <div key={col} className="kanban-col">
              <h3>{TASK_STATUS_LABELS[col]} <span className="muted">({visibleTasks.filter((t) => t.status === col).length})</span></h3>
              {visibleTasks.filter((t) => t.status === col).map((t) => (
                <div key={t.id} className={`task-card${isOverdue(t) ? ' overdue' : ''}`}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <strong>{t.title}</strong>
                    {eventIsLive && (
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => deleteTask(t.id, t.title)} disabled={act.busy} aria-label={`Delete task ${t.title}`}>
                        Delete
                      </button>
                    )}
                  </div>
                  {t.description && <p className="small muted">{t.description}</p>}
                  <p className="small">Due {formatPKT(t.due_at)} · <span className={`prio prio-${t.priority}`}>{labelize(t.priority)}</span></p>
                  <label className="small">
                    Assignee
                    <select
                      value={t.assignee_id ?? ''}
                      disabled={!eventIsLive || act.busy}
                      onChange={(e) => updateTask(t.id, { assignee_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Unassigned</option>
                      {volunteers.map((v) => <option key={v.student_id} value={v.student_id}>{v.name}</option>)}
                    </select>
                  </label>
                  <label className="small">
                    Status
                    <select value={t.status} disabled={!eventIsLive || act.busy} onChange={(e) => updateTask(t.id, { status: e.target.value })}>
                      {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          ))}
        </div>
        {tasks.length === 0 && <Empty>No tasks yet.</Empty>}
      </section>

      <section className="section" id="expenses">
        <div className="page-head">
          <div>
            <h2>Expenses</h2>
            <p className="muted small">{visibleExpenses.length} of {expenses.length} shown</p>
          </div>
          <div className="row">
            <input
              className="search-input"
              type="search"
              placeholder="Search description or vendor"
              value={expQuery}
              onChange={(e) => setExpQuery(e.target.value)}
              aria-label="Search expenses"
            />
            <select value={expCategory} onChange={(e) => setExpCategory(e.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn" onClick={() => downloadExpenseReport(id, ev.title).catch((err) => act.setError(err.message))} disabled={!expenses.length}>
              Download PDF report
            </button>
          </div>
        </div>
        {ev.actions.add_expenses ? (
          <form className="card form-grid" onSubmit={addExpense}>
            <label className="span-2">
              Description
              <input required value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} />
            </label>
            <label>
              Amount (PKR)
              <input type="number" min="0.01" step="0.01" required value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
            </label>
            <label>
              Date spent
              <input type="date" value={expenseForm.spent_on} onChange={(e) => setExpenseForm({ ...expenseForm, spent_on: e.target.value })} />
            </label>
            <label>
              Category
              <select value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Vendor (optional)
              <input value={expenseForm.vendor} onChange={(e) => setExpenseForm({ ...expenseForm, vendor: e.target.value })} />
            </label>
            <label className="span-2">
              Receipt (optional: JPG, PNG, WebP or PDF, up to 5 MB)
              <input
                key={receiptKey}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="span-2 form-actions">
              <button className="btn btn-primary" type="submit" disabled={act.busy}>Record expense</button>
              <span className="muted small">Remaining budget: {money(ev.budget_remaining)}</span>
            </div>
          </form>
        ) : (
          <Alert kind="info">
            {ev.status === 'approved' && ev.budget_remaining !== null && ev.budget_remaining <= 0
              ? 'The approved budget is fully spent, so no new expenses can be recorded.'
              : 'Expenses can be recorded once the event budget is approved.'}
          </Alert>
        )}

        {expenses.length === 0 && <Empty>No expenses recorded.</Empty>}
        {expenses.length > 0 && visibleExpenses.length === 0 && <Empty>No expenses match these filters.</Empty>}
        {visibleExpenses.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Description</th><th>Amount</th><th>Recorded by</th><th>Receipt</th><th></th></tr>
              </thead>
              <tbody>
                {visibleExpenses.map((x) => (
                  editingExpense?.id === x.id ? (
                    <tr key={x.id}>
                      <td colSpan={6}>
                        <form className="form-grid" onSubmit={saveExpense}>
                          <label className="span-2">
                            Replace receipt (optional)
                            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setEditReceipt(e.target.files?.[0] ?? null)} />
                          </label>
                          <input required value={editingExpense.description} onChange={(e) => setEditingExpense({ ...editingExpense, description: e.target.value })} aria-label="Description" />
                          <input type="number" min="0.01" step="0.01" required value={editingExpense.amount} onChange={(e) => setEditingExpense({ ...editingExpense, amount: e.target.value })} aria-label="Amount" />
                          <input type="date" value={editingExpense.spent_on} onChange={(e) => setEditingExpense({ ...editingExpense, spent_on: e.target.value })} aria-label="Date" />
                          <select value={editingExpense.category} onChange={(e) => setEditingExpense({ ...editingExpense, category: e.target.value })} aria-label="Category">
                            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input value={editingExpense.vendor} onChange={(e) => setEditingExpense({ ...editingExpense, vendor: e.target.value })} aria-label="Vendor" placeholder="Vendor (optional)" />
                          <div className="form-actions">
                            <button className="btn btn-primary btn-small" type="submit" disabled={act.busy}>Save</button>
                            <button className="btn btn-small" type="button" onClick={() => setEditingExpense(null)}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={x.id}>
                      <td>{x.spent_on}</td>
                      <td>
                        {x.description}
                        <div className="muted small">{x.category}{x.vendor ? ` · ${x.vendor}` : ''}</div>
                      </td>
                      <td>{money(x.amount)}</td>
                      <td>{x.recorded_by}</td>
                      <td>
                        {x.has_receipt ? (
                          <button className="btn btn-small" onClick={() => viewReceipt(x.id)}>View</button>
                        ) : (
                          <span className="muted small">None</span>
                        )}
                      </td>
                      <td className="row">
                        <button className="btn btn-small" onClick={() => setEditingExpense({ id: x.id, description: x.description, amount: x.amount, spent_on: x.spent_on, category: x.category, vendor: x.vendor ?? '' })} disabled={!eventIsLive}>Edit</button>
                        <button className="btn btn-small btn-danger" onClick={() => deleteExpense(x.id)} disabled={!eventIsLive || act.busy}>Delete</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
