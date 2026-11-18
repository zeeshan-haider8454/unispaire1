import { Router } from 'express';
import { db, transaction } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole, optionalAuth } from '../lib/auth.js';
import { eventFlags, pktToIso, round2, progressPercent, nowIso } from '../lib/domain.js';
import { EVENT_SELECT, loadEvent, eventStats, countRegistered, canSeeAll, serializeEvent } from '../lib/events.js';
import { notify, notifyAdmins, emitEvent, signal } from '../lib/realtime.js';
import { receiptUpload, deleteReceiptFile, receiptPath } from '../lib/receipts.js';
import { buildExpenseReport } from '../lib/expenseReport.js';

const router = Router();
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TASK_STATUSES = ['todo', 'in_progress', 'completed'];
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// Writes are restricted to the event's own president.
function loadForWrite(req) {
  const ev = loadEvent(req.params.id);
  if (ev.owner_id !== req.user.id) throw new AppError(403, 'Only the society president can change this event.');
  return ev;
}

// Reads of management data are limited to the president and administrators.
function loadForRead(req) {
  const ev = loadEvent(req.params.id);
  if (!canSeeAll(req.user, ev)) throw new AppError(403, 'Only the society president or an administrator can view this.');
  return ev;
}

function parseEventInput(body = {}) {
  const title = clean(body.title);
  const venue = clean(body.venue);
  const description = clean(body.description);
  if (!title) throw new AppError(400, 'Title is required.');
  if (!venue) throw new AppError(400, 'Venue is required.');

  const start_at = pktToIso(body.start_at);
  const end_at = pktToIso(body.end_at);
  const registration_deadline = pktToIso(body.registration_deadline);
  if (!start_at || !end_at || !registration_deadline) {
    throw new AppError(400, 'Start, end and registration deadline are required (Pakistan time).');
  }
  if (Date.parse(start_at) >= Date.parse(end_at)) throw new AppError(400, 'Start must be before end.');
  if (Date.parse(registration_deadline) > Date.parse(start_at)) {
    throw new AppError(400, 'Registration deadline must be on or before the start.');
  }

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1) throw new AppError(400, 'Capacity must be at least 1.');

  const proposed_budget = Number(body.proposed_budget);
  if (!Number.isFinite(proposed_budget) || proposed_budget < 0) {
    throw new AppError(400, 'Proposed budget must be at least 0.');
  }

  return {
    title, description, venue, start_at, end_at, registration_deadline,
    capacity, proposed_budget: round2(proposed_budget),
  };
}

function parseTaskInput(body = {}) {
  const title = clean(body.title);
  if (!title) throw new AppError(400, 'Task title is required.');
  const priority = body.priority ?? 'medium';
  if (!PRIORITIES.includes(priority)) throw new AppError(400, 'Priority must be low, medium, high or urgent.');
  const due_at = pktToIso(body.due_at);
  if (!due_at) throw new AppError(400, 'A due date is required (Pakistan time).');
  return { title, description: clean(body.description), priority, due_at };
}

export const EXPENSE_CATEGORIES = ['Venue', 'Food and refreshments', 'Printing and stationery', 'Equipment', 'Transport', 'Prizes', 'Marketing', 'Other'];

function parseExpenseInput(body = {}) {
  const description = clean(body.description);
  if (!description) throw new AppError(400, 'Description is required.');
  const amount = round2(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, 'Amount must be greater than 0.');
  const spent_on = /^\d{4}-\d{2}-\d{2}$/.test(body.spent_on ?? '')
    ? body.spent_on
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const category = clean(body.category) || 'Other';
  if (!EXPENSE_CATEGORIES.includes(category)) throw new AppError(400, 'Choose a category from the list.');
  const vendor = clean(body.vendor);
  if (vendor.length > 120) throw new AppError(400, 'Vendor name must be 120 characters or fewer.');
  return { description, amount, spent_on, category, vendor };
}

const acceptedVolunteer = (eventId, studentId) =>
  db.prepare("SELECT 1 FROM invitations WHERE event_id = ? AND student_id = ? AND status = 'accepted'").get(eventId, studentId);

// ---------------------------------------------------------------------------
// Public listing and event pages
// ---------------------------------------------------------------------------

// Approved upcoming and ongoing events, used by the landing page.
router.get('/events/public', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 6, 50);
  const rows = db.prepare(`${EVENT_SELECT} WHERE e.status = 'approved' AND e.end_at > ? ORDER BY e.start_at ASC LIMIT ?`)
    .all(nowIso(), limit);
  res.json(rows.map((ev) => serializeEvent(ev, null)));
});

// Events of all societies owned by the signed-in president.
router.get('/events/mine', requireAuth, requireRole('president'), (req, res) => {
  const rows = db.prepare(`${EVENT_SELECT} WHERE s.owner_id = ? ORDER BY e.start_at DESC`).all(req.user.id);
  return res.json(rows.map((ev) => serializeEvent(ev, req.user)));
});

router.post('/events', requireAuth, requireRole('president'), (req, res) => {
  const owned = db.prepare('SELECT id FROM societies WHERE owner_id = ? ORDER BY id').all(req.user.id);
  if (owned.length === 0) throw new AppError(400, 'Create a society before creating events.');

  // With more than one society, the request must say which one the event belongs to.
  const requestedId = req.body?.society_id;
  if (owned.length > 1 && (requestedId === undefined || requestedId === null || requestedId === '')) {
    throw new AppError(400, 'Choose which society this event belongs to.');
  }
  const society = owned.find((s) => s.id === Number(requestedId ?? owned[0].id));
  if (!society) throw new AppError(403, 'You can create events only for your own societies.');

  const v = parseEventInput(req.body);
  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO events (society_id, title, description, venue, start_at, end_at, registration_deadline,
                        capacity, proposed_budget, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(
    society.id, v.title, v.description, v.venue, v.start_at, v.end_at,
    v.registration_deadline, v.capacity, v.proposed_budget, now, now,
  );
  res.status(201).json(serializeEvent(loadEvent(info.lastInsertRowid), req.user));
});

// Approved events are public by direct link (including completed ones). Other states are visible only to their president and administrators.
router.get('/events/:id', optionalAuth, (req, res) => {
  const ev = loadEvent(req.params.id);
  if (!canSeeAll(req.user, ev) && ev.status !== 'approved') throw new AppError(404, 'Event not found.');

  const out = serializeEvent(ev, req.user);
  if (req.user?.role === 'student') {
    out.my_registration = db.prepare('SELECT status FROM registrations WHERE event_id = ? AND student_id = ?')
      .get(ev.id, req.user.id)?.status ?? null;
    out.my_invitation = db.prepare('SELECT status FROM invitations WHERE event_id = ? AND student_id = ?')
      .get(ev.id, req.user.id)?.status ?? null;
  }
  res.json(out);
});

router.put('/events/:id', requireAuth, requireRole('president'), (req, res) => {
  const ev = loadForWrite(req);
  if (!eventFlags(ev).actions.edit) {
    throw new AppError(409, 'This event can no longer be edited (it has started, is pending review, or is cancelled).');
  }
  const v = parseEventInput(req.body);
  const { registered } = eventStats(ev.id);
  if (v.capacity < registered) {
    throw new AppError(400, `Capacity cannot be lower than the ${registered} active registration(s).`);
  }

  // Editing an approved event sends it back for re-approval. The last approved budget stays in force until then.
  const status = ev.status === 'approved' ? 'pending' : ev.status;
  db.prepare(`
    UPDATE events SET title = ?, description = ?, venue = ?, start_at = ?, end_at = ?, registration_deadline = ?,
      capacity = ?, proposed_budget = ?, status = ?, updated_at = ?
    WHERE id = ?`).run(
    v.title, v.description, v.venue, v.start_at, v.end_at, v.registration_deadline,
    v.capacity, v.proposed_budget, status, nowIso(), ev.id,
  );

  if (ev.status === 'approved') {
    notifyAdmins({
      type: 'event_submitted',
      message: `"${v.title}" was edited and needs re-approval (proposed budget PKR ${v.proposed_budget}).`,
      link: '/admin',
    });
  }
  emitEvent(ev.id, { status });
  signal([ev.owner_id], 'events');
  res.json(serializeEvent(loadEvent(ev.id), req.user));
});

router.post('/events/:id/submit', requireAuth, requireRole('president'), (req, res) => {
  const ev = loadForWrite(req);
  if (!eventFlags(ev).actions.submit) {
    throw new AppError(409, 'Only Draft or Rejected events that have not started can be submitted.');
  }
  db.prepare("UPDATE events SET status = 'pending', updated_at = ? WHERE id = ?").run(nowIso(), ev.id);
  notifyAdmins({
    type: 'event_submitted',
    message: `New event proposal "${ev.title}" from ${ev.society_name} is awaiting approval.`,
    link: '/admin',
  });
  emitEvent(ev.id, { status: 'pending' });
  signal([ev.owner_id], 'events');
  res.json(serializeEvent(loadEvent(ev.id), req.user));
});

// Cancellation is irreversible. Registrations are kept with status cancelled; invitations stay as records.
router.post('/events/:id/cancel', requireAuth, requireRole('president'), (req, res) => {
  const ev = loadForWrite(req);
  if (!eventFlags(ev).actions.cancel) throw new AppError(409, 'This event cannot be cancelled.');

  const affected = transaction(() => {
    const registered = db.prepare("SELECT student_id FROM registrations WHERE event_id = ? AND status = 'registered'")
      .all(ev.id).map((r) => r.student_id);
    const volunteers = db.prepare("SELECT student_id FROM invitations WHERE event_id = ? AND status IN ('invited', 'accepted')")
      .all(ev.id).map((r) => r.student_id);
    const now = nowIso();
    db.prepare("UPDATE registrations SET status = 'cancelled', updated_at = ? WHERE event_id = ? AND status = 'registered'").run(now, ev.id);
    db.prepare("UPDATE events SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").run(now, now, ev.id);
    return [...new Set([...registered, ...volunteers])];
  });

  notify(affected, { type: 'event_cancelled', message: `"${ev.title}" has been cancelled.`, link: `/events/${ev.id}` });
  signal([...affected, ev.owner_id], 'events');
  emitEvent(ev.id, { status: 'cancelled' });
  res.json(serializeEvent(loadEvent(ev.id), req.user));
});

// ---------------------------------------------------------------------------
// Registrations (students)
// ---------------------------------------------------------------------------

router.post('/events/:id/register', requireAuth, requireRole('student'), (req, res) => {
  const ev = loadEvent(req.params.id);
  if (ev.status !== 'approved') throw new AppError(409, 'Registration is not open for this event.');
  if (Date.now() >= Date.parse(ev.start_at)) throw new AppError(409, 'This event has already started.');
  if (Date.now() >= Date.parse(ev.registration_deadline)) throw new AppError(409, 'The registration deadline has passed.');

  transaction(() => {
    const existing = db.prepare('SELECT * FROM registrations WHERE event_id = ? AND student_id = ?').get(ev.id, req.user.id);
    if (existing?.status === 'registered') throw new AppError(409, 'You are already registered for this event.');
    if (countRegistered(ev.id) >= ev.capacity) throw new AppError(409, 'This event is full.');

    if (existing) {
      db.prepare("UPDATE registrations SET status = 'registered', updated_at = ? WHERE id = ?").run(nowIso(), existing.id);
    } else {
      const now = nowIso();
      db.prepare("INSERT INTO registrations (event_id, student_id, status, created_at, updated_at) VALUES (?, ?, 'registered', ?, ?)")
        .run(ev.id, req.user.id, now, now);
    }
  });

  notify([ev.owner_id], {
    type: 'new_registration',
    message: `${req.user.name} registered for "${ev.title}".`,
    link: `/president/events/${ev.id}`,
  });
  emitEvent(ev.id, { registrations: true });
  signal([ev.owner_id], 'registrations');
  res.json({ status: 'registered', event: serializeEvent(loadEvent(ev.id), req.user) });
});

router.delete('/events/:id/register', requireAuth, requireRole('student'), (req, res) => {
  const ev = loadEvent(req.params.id);
  if (ev.status === 'cancelled') throw new AppError(409, 'This event was cancelled.');
  if (Date.now() >= Date.parse(ev.start_at)) throw new AppError(409, 'Registrations cannot be cancelled after the event starts.');

  const reg = db.prepare("SELECT id FROM registrations WHERE event_id = ? AND student_id = ? AND status = 'registered'")
    .get(ev.id, req.user.id);
  if (!reg) throw new AppError(404, 'You are not registered for this event.');

  db.prepare("UPDATE registrations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), reg.id);
  notify([ev.owner_id], {
    type: 'registration_cancelled',
    message: `${req.user.name} cancelled their registration for "${ev.title}".`,
    link: `/president/events/${ev.id}`,
  });
  emitEvent(ev.id, { registrations: true });
  signal([ev.owner_id], 'registrations');
  res.json({ status: 'cancelled' });
});

router.get('/registrations/mine', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.status, r.created_at, e.id AS event_id, e.title, e.start_at, e.end_at, e.status AS event_status,
      s.name AS society_name
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE r.student_id = ? ORDER BY e.start_at`).all(req.user.id);
  res.json(rows);
});

router.get('/events/:id/registrations', requireAuth, (req, res) => {
  loadForRead(req);
  const rows = db.prepare(`
    SELECT r.id, r.status, r.created_at, u.name, u.email
    FROM registrations r JOIN users u ON u.id = r.student_id
    WHERE r.event_id = ? ORDER BY r.created_at`).all(req.params.id);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Volunteer invitations
// ---------------------------------------------------------------------------

// Students for the invite picker. Approved society members are listed first.
router.get('/events/:id/invite-candidates', requireAuth, requireRole('president'), (req, res) => {
  const ev = loadForWrite(req);
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email,
      EXISTS (SELECT 1 FROM memberships m WHERE m.society_id = ? AND m.student_id = u.id AND m.status = 'approved') AS is_member,
      (SELECT i.status FROM invitations i WHERE i.event_id = ? AND i.student_id = u.id) AS invitation_status
    FROM users u WHERE u.role = 'student'
    ORDER BY is_member DESC, u.name`).all(ev.society_id, ev.id);
  res.json(rows.map((r) => ({ ...r, is_member: Boolean(r.is_member) })));
});

router.get('/events/:id/invitations', requireAuth, (req, res) => {
  loadForRead(req);
  const rows = db.prepare(`
    SELECT i.id, i.status, i.created_at, i.responded_at, u.id AS student_id, u.name, u.email
    FROM invitations i JOIN users u ON u.id = i.student_id
    WHERE i.event_id = ? ORDER BY i.created_at DESC`).all(req.params.id);
  res.json(rows);
});

router.post('/events/:id/invitations', requireAuth, requireRole('president'), (req, res) => {
  const ev = loadForWrite(req);
  if (!eventFlags(ev).actions.invite) {
    throw new AppError(409, 'Volunteers can be invited only to approved events that have not started.');
  }
  const student = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'student'").get(Number(req.body?.student_id));
  if (!student) throw new AppError(404, 'Student not found.');

  const existing = db.prepare('SELECT status FROM invitations WHERE event_id = ? AND student_id = ?').get(ev.id, student.id);
  if (existing?.status === 'declined') {
    throw new AppError(409, 'This student declined an invitation to this event and cannot be re-invited.');
  }
  if (existing) throw new AppError(409, 'This student already has an invitation for this event.');

  db.prepare("INSERT INTO invitations (event_id, student_id, status, created_at) VALUES (?, ?, 'invited', ?)")
    .run(ev.id, student.id, nowIso());
  notify([student.id], {
    type: 'volunteer_invitation',
    message: `${ev.society_name} invited you to volunteer for "${ev.title}".`,
    link: '/student',
  });
  signal([student.id], 'volunteers');
  res.status(201).json({ status: 'invited' });
});

// An accepted volunteer withdraws. Incomplete tasks are unassigned (In Progress resets to To Do),
// completed tasks keep their volunteer for history, and the president is notified.
router.post('/invitations/:id/withdraw', requireAuth, requireRole('student'), (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, e.title, e.status AS event_status, e.end_at, s.owner_id
    FROM invitations i
    JOIN events e ON e.id = i.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE i.id = ?`).get(req.params.id);
  if (!inv || inv.student_id !== req.user.id) throw new AppError(404, 'Invitation not found.');
  if (inv.status !== 'accepted') throw new AppError(409, 'Only an accepted invitation can be withdrawn.');
  if (inv.event_status === 'cancelled') throw new AppError(409, 'This event was cancelled.');
  if (Date.now() >= Date.parse(inv.end_at)) throw new AppError(409, 'This event has already ended.');

  const released = transaction(() => {
    const now = nowIso();
    db.prepare("UPDATE invitations SET status = 'withdrawn', responded_at = ? WHERE id = ?").run(now, inv.id);
    db.prepare("UPDATE tasks SET assignee_id = NULL, status = 'todo', updated_at = ? WHERE event_id = ? AND assignee_id = ? AND status = 'in_progress'")
      .run(now, inv.event_id, req.user.id);
    return db.prepare("UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE event_id = ? AND assignee_id = ? AND status = 'todo'")
      .run(now, inv.event_id, req.user.id).changes;
  });

  notify([inv.owner_id], {
    type: 'volunteer_withdrawn',
    message: `${req.user.name} withdrew from volunteering for "${inv.title}".`,
    link: `/president/events/${inv.event_id}`,
  });
  signal([inv.owner_id, req.user.id], 'volunteers');
  signal([inv.owner_id, req.user.id], 'tasks');
  emitEvent(inv.event_id, { volunteers: true, tasks: true });
  res.json({ status: 'withdrawn', tasks_unassigned: released });
});

router.get('/invitations/mine', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.status, i.created_at, e.id AS event_id, e.title, e.venue, e.start_at, e.end_at,
      e.status AS event_status, s.name AS society_name
    FROM invitations i
    JOIN events e ON e.id = i.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE i.student_id = ? ORDER BY e.start_at`).all(req.user.id);
  res.json(rows);
});

// Responses are final.
router.post('/invitations/:id/respond', requireAuth, requireRole('student'), (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, e.title, e.status AS event_status, s.owner_id
    FROM invitations i
    JOIN events e ON e.id = i.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE i.id = ?`).get(req.params.id);
  if (!inv || inv.student_id !== req.user.id) throw new AppError(404, 'Invitation not found.');
  if (inv.status !== 'invited') throw new AppError(409, 'This invitation has already been answered. Responses are final.');
  if (inv.event_status === 'cancelled') throw new AppError(409, 'This event was cancelled.');

  const accept = req.body?.accept === true;
  const status = accept ? 'accepted' : 'declined';
  db.prepare('UPDATE invitations SET status = ?, responded_at = ? WHERE id = ?').run(status, nowIso(), inv.id);
  notify([inv.owner_id], {
    type: 'invitation_response',
    message: `${req.user.name} ${status} the volunteer invitation for "${inv.title}".`,
    link: `/president/events/${inv.event_id}`,
  });
  signal([inv.owner_id, req.user.id], 'volunteers');
  emitEvent(inv.event_id, { volunteers: true });
  res.json({ status });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const listTasks = (eventId) => db.prepare(`
  SELECT t.*, u.name AS assignee_name
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
  WHERE t.event_id = ? ORDER BY t.due_at, t.id`).all(eventId);

// Visible to the president, administrators and accepted volunteers.
router.get('/events/:id/tasks', requireAuth, (req, res) => {
  const ev = loadEvent(req.params.id);
  const isVolunteer = req.user.role === 'student' && acceptedVolunteer(ev.id, req.user.id);
  if (!canSeeAll(req.user, ev) && !isVolunteer) throw new AppError(403, 'You are not a volunteer for this event.');

  const stats = eventStats(ev.id);
  res.json({
    tasks: listTasks(ev.id),
    total: stats.taskTotal,
    completed: stats.taskDone,
    progress: progressPercent(stats.taskDone, stats.taskTotal),
  });
});

router.post('/events/:id/tasks', requireAuth, requireRole('president'), (req, res) => {
  const ev = loadForWrite(req);
  if (!eventFlags(ev).actions.add_tasks) throw new AppError(409, 'Tasks cannot be added to a cancelled event.');
  const v = parseTaskInput(req.body);
  const now = nowIso();
  db.prepare(`
    INSERT INTO tasks (event_id, title, description, priority, due_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'todo', ?, ?)`).run(ev.id, v.title, v.description, v.priority, v.due_at, now, now);
  emitEvent(ev.id, { tasks: true });
  res.status(201).json({ ok: true });
});

const TASK_SELECT = `
  SELECT t.*, e.status AS event_status, e.title AS event_title, e.id AS event_id, s.owner_id
  FROM tasks t
  JOIN events e ON e.id = t.event_id
  JOIN societies s ON s.id = e.society_id`;

// The president can edit any task field and assign volunteers. An assignee can change only the status.
router.patch('/tasks/:id', requireAuth, (req, res) => {
  const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!task) throw new AppError(404, 'Task not found.');

  const isOwner = task.owner_id === req.user.id;
  const isAssignee = task.assignee_id === req.user.id;
  if (!isOwner && !isAssignee) throw new AppError(403, 'You can update only your own tasks.');
  if (task.event_status === 'cancelled') throw new AppError(409, 'Tasks of a cancelled event are frozen.');

  const body = req.body ?? {};
  if (!isOwner && Object.keys(body).some((key) => key !== 'status')) {
    throw new AppError(403, 'Volunteers can only update the task status.');
  }

  const next = {
    title: task.title,
    description: task.description,
    priority: task.priority,
    due_at: task.due_at,
    status: task.status,
    assignee_id: task.assignee_id,
  };

  if (isOwner) {
    if ('title' in body) {
      next.title = clean(body.title);
      if (!next.title) throw new AppError(400, 'Task title is required.');
    }
    if ('description' in body) next.description = clean(body.description);
    if ('priority' in body) {
      if (!PRIORITIES.includes(body.priority)) throw new AppError(400, 'Priority must be low, medium, high or urgent.');
      next.priority = body.priority;
    }
    if ('due_at' in body) {
      next.due_at = pktToIso(body.due_at);
      if (!next.due_at) throw new AppError(400, 'A due date is required (Pakistan time).');
    }
    if ('assignee_id' in body) {
      const assignee = body.assignee_id === null || body.assignee_id === '' ? null : Number(body.assignee_id);
      if (assignee !== null && !acceptedVolunteer(task.event_id, assignee)) {
        throw new AppError(400, 'Only students who accepted a volunteer invitation can be assigned tasks.');
      }
      next.assignee_id = assignee;
    }
  }

  if ('status' in body) {
    if (!TASK_STATUSES.includes(body.status)) throw new AppError(400, 'Status must be todo, in_progress or completed.');
    next.status = body.status;
  }

  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, priority = ?, due_at = ?, status = ?, assignee_id = ?, updated_at = ?
    WHERE id = ?`).run(next.title, next.description, next.priority, next.due_at, next.status, next.assignee_id, nowIso(), task.id);

  const statusLabel = { todo: 'To Do', in_progress: 'In Progress', completed: 'Completed' };
  if (next.assignee_id && next.assignee_id !== task.assignee_id) {
    notify([next.assignee_id], {
      type: 'task_assigned',
      message: `You were assigned "${next.title}" for "${task.event_title}".`,
      link: '/student',
    });
  }
  if (next.status !== task.status) {
    if (isOwner && task.assignee_id) {
      notify([task.assignee_id], {
        type: 'task_status',
        message: `"${next.title}" was moved to ${statusLabel[next.status]}.`,
        link: '/student',
      });
    }
    if (isAssignee) {
      notify([task.owner_id], {
        type: 'task_status',
        message: `${req.user.name} moved "${next.title}" to ${statusLabel[next.status]}.`,
        link: `/president/events/${task.event_id}`,
      });
    }
  }

  signal([task.owner_id, task.assignee_id, next.assignee_id], 'tasks');
  emitEvent(task.event_id, { tasks: true });
  res.json({ ok: true });
});

// The president deletes a task from their event. An assigned volunteer is told the task was removed.
router.delete('/tasks/:id', requireAuth, requireRole('president'), (req, res) => {
  const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!task) throw new AppError(404, 'Task not found.');
  if (task.owner_id !== req.user.id) throw new AppError(403, 'You can delete only tasks from your own events.');
  if (task.event_status === 'cancelled') throw new AppError(409, 'Tasks of a cancelled event are frozen.');

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  if (task.assignee_id) {
    notify([task.assignee_id], {
      type: 'task_removed',
      message: `The task "${task.title}" for "${task.event_title}" was removed.`,
      link: '/student',
    });
  }
  signal([task.owner_id, task.assignee_id], 'tasks');
  emitEvent(task.event_id, { tasks: true });
  res.json({ ok: true });
});

router.get('/tasks/mine', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, e.id AS event_id, e.title AS event_title, e.status AS event_status, s.name AS society_name
    FROM tasks t
    JOIN events e ON e.id = t.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE t.assignee_id = ? ORDER BY t.due_at, t.id`).all(req.user.id);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Expenses (hard budget cap: total spending cannot exceed the approved budget)
// ---------------------------------------------------------------------------

// Hides the stored file name; clients only learn whether a receipt exists.
const publicExpense = ({ receipt_file, ...rest }) => ({ ...rest, has_receipt: Boolean(receipt_file) });

// Removes the uploaded file if the request fails after multer has saved it.
const cleanUploadOnError = (handler) => (req, res, next) => {
  try {
    handler(req, res, next);
  } catch (err) {
    if (req.file) deleteReceiptFile(req.file.filename);
    next(err);
  }
};

router.get('/events/:id/expenses', requireAuth, (req, res) => {
  const ev = loadForRead(req);
  const rows = db.prepare(`
    SELECT x.*, u.name AS recorded_by
    FROM expenses x LEFT JOIN users u ON u.id = x.created_by
    WHERE x.event_id = ? ORDER BY x.spent_on DESC, x.id DESC`).all(ev.id);
  res.json({ expenses: rows.map(publicExpense), event: serializeEvent(ev, req.user) });
});

// Downloadable PDF of one event's budget and expenses. Same access rule as the expense list.
router.get('/events/:id/expense-report.pdf', requireAuth, async (req, res, next) => {
  try {
    const ev = loadForRead(req);
    const pdf = await buildExpenseReport(ev);
    const safeTitle = ev.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="expense-report-${safeTitle}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Opens a receipt. Only the event's president and administrators can see it.
router.get('/expenses/:id/receipt', requireAuth, (req, res) => {
  const expense = db.prepare(`
    SELECT x.receipt_file, x.receipt_name, x.receipt_mime, x.event_id, s.owner_id
    FROM expenses x JOIN events e ON e.id = x.event_id JOIN societies s ON s.id = e.society_id
    WHERE x.id = ?`).get(req.params.id);
  if (!expense) throw new AppError(404, 'Expense not found.');
  if (!canSeeAll(req.user, { owner_id: expense.owner_id })) throw new AppError(403, 'You cannot view this receipt.');
  if (!expense.receipt_file) throw new AppError(404, 'This expense has no receipt.');

  res.type(expense.receipt_mime);
  res.set('Content-Disposition', `inline; filename="${expense.receipt_name.replace(/"/g, '')}"`);
  res.sendFile(receiptPath(expense.receipt_file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Receipt file is missing.' });
  });
});

router.post('/events/:id/expenses', requireAuth, requireRole('president'), receiptUpload, cleanUploadOnError((req, res) => {
  const ev = loadForWrite(req);
  const v = parseExpenseInput(req.body);
  const { spent } = eventStats(ev.id);
  const flags = eventFlags(ev, { spent });

  if (!flags.actions.add_expenses) {
    if (ev.status !== 'approved') {
      throw new AppError(409, 'Expenses can be recorded only while the event is approved.');
    }
    throw new AppError(409, 'Recorded spending has reached the approved budget, so no new expenses can be added.');
  }
  if (round2(spent + v.amount) > ev.approved_budget) {
    throw new AppError(400, `This expense exceeds the remaining budget of PKR ${flags.budget_remaining}.`);
  }

  const now = nowIso();
  const file = req.file;
  db.prepare(`
    INSERT INTO expenses (event_id, description, amount, spent_on, created_by, created_at, updated_at,
                          receipt_file, receipt_name, receipt_mime, category, vendor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    ev.id, v.description, v.amount, v.spent_on, req.user.id, now, now,
    file?.filename ?? null, file?.originalname ?? null, file?.mimetype ?? null,
    v.category, v.vendor,
  );
  emitEvent(ev.id, { expenses: true });
  res.status(201).json({ ok: true });
}));

function loadExpense(req) {
  const expense = db.prepare(`
    SELECT x.*, e.status AS event_status, e.approved_budget, s.owner_id
    FROM expenses x
    JOIN events e ON e.id = x.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE x.id = ?`).get(req.params.id);
  if (!expense) throw new AppError(404, 'Expense not found.');
  if (expense.owner_id !== req.user.id) throw new AppError(403, 'Only the society president can change this expense.');
  if (expense.event_status === 'cancelled') throw new AppError(409, 'Expenses of a cancelled event are frozen.');
  return expense;
}

// A new receipt replaces the old one. Without a new file, the existing receipt is kept.
router.put('/expenses/:id', requireAuth, requireRole('president'), receiptUpload, cleanUploadOnError((req, res) => {
  const expense = loadExpense(req);
  const v = parseExpenseInput(req.body);
  const { spent } = eventStats(expense.event_id);
  const delta = round2(v.amount - expense.amount);
  // Edits that increase spending must still fit within the approved budget.
  if (delta > 0 && round2(spent + delta) > expense.approved_budget) {
    throw new AppError(400, `This change would exceed the approved budget of PKR ${expense.approved_budget}.`);
  }
  const file = req.file;
  db.prepare(`
    UPDATE expenses SET description = ?, amount = ?, spent_on = ?, updated_at = ?, category = ?, vendor = ?,
      receipt_file = COALESCE(?, receipt_file), receipt_name = COALESCE(?, receipt_name), receipt_mime = COALESCE(?, receipt_mime)
    WHERE id = ?`).run(
    v.description, v.amount, v.spent_on, nowIso(), v.category, v.vendor,
    file?.filename ?? null, file?.originalname ?? null, file?.mimetype ?? null,
    expense.id,
  );
  if (file && expense.receipt_file) deleteReceiptFile(expense.receipt_file);
  emitEvent(expense.event_id, { expenses: true });
  res.json({ ok: true });
}));

router.delete('/expenses/:id', requireAuth, requireRole('president'), (req, res) => {
  const expense = loadExpense(req);
  db.prepare('DELETE FROM expenses WHERE id = ?').run(expense.id);
  deleteReceiptFile(expense.receipt_file);
  emitEvent(expense.event_id, { expenses: true });
  res.json({ ok: true });
});

export default router;
