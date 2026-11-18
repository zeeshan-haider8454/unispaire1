import { Router } from 'express';
import { db, transaction } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { pktToIso, nowIso, round2, progressPercent } from '../lib/domain.js';
import { notify, signal } from '../lib/realtime.js';
import { EXPENSE_CATEGORIES } from './events.js';

// Task 2: Mega Events and their sub-events. These are internal records. They never appear in the Task 1
// public listing, have no public registration, and do not use event approval or volunteer invitations.
const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TASK_STATUSES = ['todo', 'in_progress', 'completed'];
const STATUS_TEXT = { todo: 'To Do', in_progress: 'In Progress', completed: 'Completed' };
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

const pktDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
// Converts a UTC timestamp back to Pakistan time HH:mm, for editing forms.
const pktTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function requireDate(value, label) {
  if (!DATE_RE.test(value ?? '')) throw new AppError(400, `${label} is required (YYYY-MM-DD, Pakistan time).`);
  return value;
}

function requireTime(value, label) {
  if (!TIME_RE.test(value ?? '')) throw new AppError(400, `${label} is required (HH:mm, Pakistan time).`);
  return value;
}

// A student is an existing Student / Volunteer account. No new role is created for supervisors.
function requireStudent(id) {
  const user = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'student'").get(Number(id));
  if (!user) throw new AppError(400, 'Choose a registered Student / Volunteer account.');
  return user;
}

function loadMega(id) {
  const m = db.prepare(`
    SELECT m.*, s.name AS society_name, p.name AS president_name
    FROM mega_events m
    JOIN societies s ON s.id = m.society_id
    JOIN users p ON p.id = m.president_id
    WHERE m.id = ?`).get(id);
  if (!m) throw new AppError(404, 'Mega Event not found.');
  return m;
}

function loadSub(id) {
  const s = db.prepare(`
    SELECT se.*, m.title AS mega_title, m.president_id, m.start_date AS mega_start, m.end_date AS mega_end,
      m.overall_budget, m.society_id, sup.name AS supervisor_name
    FROM sub_events se
    JOIN mega_events m ON m.id = se.mega_event_id
    LEFT JOIN users sup ON sup.id = se.supervisor_id
    WHERE se.id = ?`).get(id);
  if (!s) throw new AppError(404, 'Sub-event not found.');
  return s;
}

const allocatedTotal = (megaId, exceptSubId = null) =>
  round2(db.prepare('SELECT COALESCE(SUM(allocated_budget), 0) AS t FROM sub_events WHERE mega_event_id = ? AND id IS NOT ?')
    .get(megaId, exceptSubId).t);

const subSpent = (subId) => round2(db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE sub_event_id = ?').get(subId).t);

function taskTotals(where, value) {
  const r = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'completed'), 0) AS done FROM tasks WHERE ${where} = ?`).get(value);
  return { total: r.total, done: r.done, progress: progressPercent(r.done, r.total) };
}

// Sub-event view. Budgets and expenses are included only for the president who owns the Mega Event.
function serializeSub(s, { privileged }) {
  const tt = taskTotals('sub_event_id', s.id);
  const out = {
    id: s.id,
    mega_event_id: s.mega_event_id,
    mega_title: s.mega_title,
    title: s.title,
    description: s.description,
    venue: s.venue,
    event_date: s.event_date,
    start_at: s.start_at,
    end_at: s.end_at,
    supervisor_id: s.supervisor_id,
    supervisor_name: s.supervisor_name ?? null,
    task_total: tt.total,
    task_done: tt.done,
    progress: tt.progress,
  };
  if (privileged) {
    const spent = subSpent(s.id);
    Object.assign(out, {
      allocated_budget: s.allocated_budget,
      spent,
      remaining: s.allocated_budget == null ? null : round2(s.allocated_budget - spent),
      warned_80: Boolean(s.warned_80),
    });
  }
  return out;
}

function serializeMega(m) {
  const subs = db.prepare('SELECT allocated_budget FROM sub_events WHERE mega_event_id = ?').all(m.id);
  const allocated = round2(subs.reduce((sum, s) => sum + (s.allocated_budget ?? 0), 0));
  const spent = round2(db.prepare(`
    SELECT COALESCE(SUM(x.amount), 0) AS t FROM expenses x JOIN sub_events se ON se.id = x.sub_event_id
    WHERE se.mega_event_id = ?`).get(m.id).t);
  const tasks = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(t.status = 'completed'), 0) AS done
    FROM tasks t JOIN sub_events se ON se.id = t.sub_event_id WHERE se.mega_event_id = ?`).get(m.id);
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    society_id: m.society_id,
    society_name: m.society_name,
    president_id: m.president_id,
    president_name: m.president_name,
    created_by: m.created_by,
    start_date: m.start_date,
    end_date: m.end_date,
    overall_budget: m.overall_budget,
    sub_event_count: subs.length,
    allocated: allocated,
    unallocated: round2(m.overall_budget - allocated),
    spent,
    remaining: round2(m.overall_budget - spent),
    task_total: tasks.total,
    task_done: tasks.done,
    progress: progressPercent(tasks.done, tasks.total),
  };
}

// Validates a sub-event's date and times: inside the Mega Event's range, start before end, same day.
function subTimes(mega, body, existing = null) {
  const date = requireDate(body.event_date ?? existing?.event_date, 'Sub-event date');
  if (date < mega.start_date || date > mega.end_date) {
    throw new AppError(400, `The sub-event date must fall between ${mega.start_date} and ${mega.end_date}.`);
  }
  const startTime = requireTime(body.start_time ?? (existing ? pktTime(existing.start_at) : undefined), 'Start time');
  const endTime = requireTime(body.end_time ?? (existing ? pktTime(existing.end_at) : undefined), 'End time');
  const start_at = pktToIso(`${date}T${startTime}`);
  const end_at = pktToIso(`${date}T${endTime}`);
  if (!start_at || !end_at) throw new AppError(400, 'Enter valid times.');
  if (Date.parse(start_at) >= Date.parse(end_at)) throw new AppError(400, 'The start time must be earlier than the end time.');
  return { event_date: date, start_at, end_at };
}

// ---------------------------------------------------------------------------
// Administrator: create and maintain Mega Events they created
// ---------------------------------------------------------------------------

router.get('/admin/mega-events', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, s.name AS society_name, p.name AS president_name
    FROM mega_events m JOIN societies s ON s.id = m.society_id JOIN users p ON p.id = m.president_id
    WHERE m.created_by = ? ORDER BY m.start_date DESC, m.id DESC`).all(req.user.id);
  res.json(rows.map(serializeMega));
});

// Societies for the create form (administrator).
router.get('/admin/mega-events/societies', requireAuth, requireRole('admin'), (req, res) => {
  res.json(db.prepare(`
    SELECT s.id, s.name, s.owner_id AS president_id, u.name AS president_name
    FROM societies s JOIN users u ON u.id = s.owner_id ORDER BY s.name`).all());
});

router.post('/admin/mega-events', requireAuth, requireRole('admin'), (req, res) => {
  const title = clean(req.body?.title);
  const description = clean(req.body?.description);
  if (!title) throw new AppError(400, 'Title is required.');
  const society = db.prepare('SELECT id, name, owner_id FROM societies WHERE id = ?').get(Number(req.body?.society_id));
  if (!society) throw new AppError(400, 'Choose a society.');
  const start = requireDate(req.body?.start_date, 'Start date');
  const end = requireDate(req.body?.end_date, 'End date');
  if (start > end) throw new AppError(400, 'The start date must be on or before the end date.');
  const budget = Number(req.body?.overall_budget);
  if (!Number.isFinite(budget) || budget < 0) throw new AppError(400, 'Overall budget must be 0 or more.');

  const now = nowIso();
  const id = Number(db.prepare(`
    INSERT INTO mega_events (title, description, society_id, president_id, created_by, start_date, end_date, overall_budget, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, description, society.id, society.owner_id, req.user.id, start, end, round2(budget), now, now).lastInsertRowid);

  notify([society.owner_id], {
    type: 'mega_event_assigned',
    message: `A Mega Event "${title}" was assigned to ${society.name}. Add its sub-events from your dashboard.`,
    link: `/president/mega/${id}`,
  });
  signal([society.owner_id], 'mega');
  res.status(201).json(serializeMega(loadMega(id)));
});

// Only the title and description may change after creation.
router.patch('/admin/mega-events/:id', requireAuth, requireRole('admin'), (req, res) => {
  const m = loadMega(req.params.id);
  if (m.created_by !== req.user.id) throw new AppError(403, 'You can change only Mega Events you created.');
  const fixed = ['society_id', 'president_id', 'start_date', 'end_date', 'overall_budget'];
  for (const key of fixed) {
    if (key in (req.body ?? {}) && String(req.body[key]) !== String(m[key])) {
      throw new AppError(400, 'Only the title and description can be changed after creation.');
    }
  }
  const title = 'title' in (req.body ?? {}) ? clean(req.body.title) : m.title;
  const description = 'description' in (req.body ?? {}) ? clean(req.body.description) : m.description;
  if (!title) throw new AppError(400, 'Title is required.');
  db.prepare('UPDATE mega_events SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(title, description, nowIso(), m.id);
  notify([m.president_id], { type: 'mega_event_updated', message: `The Mega Event "${title}" was updated.`, link: `/president/mega/${m.id}` });
  signal([m.president_id], 'mega');
  res.json(serializeMega(loadMega(m.id)));
});

// ---------------------------------------------------------------------------
// Society President: manage sub-events, supervisors, tasks and budgets
// ---------------------------------------------------------------------------

router.get('/mega-events/mine', requireAuth, requireRole('president'), (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, s.name AS society_name, p.name AS president_name
    FROM mega_events m JOIN societies s ON s.id = m.society_id JOIN users p ON p.id = m.president_id
    WHERE m.president_id = ? ORDER BY m.start_date, m.id`).all(req.user.id);
  res.json(rows.map(serializeMega));
});

// Students available as supervisors or task assignees.
router.get('/students/directory', requireAuth, requireRole('president'), (req, res) => {
  res.json(db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all());
});

router.get('/mega-events/:id', requireAuth, requireRole('president'), (req, res) => {
  const m = loadMega(req.params.id);
  if (m.president_id !== req.user.id) throw new AppError(403, 'This Mega Event is not assigned to you.');
  const subs = db.prepare(`
    SELECT se.*, m.title AS mega_title, m.president_id, m.start_date AS mega_start, m.end_date AS mega_end,
      m.overall_budget, m.society_id, sup.name AS supervisor_name
    FROM sub_events se
    JOIN mega_events m ON m.id = se.mega_event_id
    LEFT JOIN users sup ON sup.id = se.supervisor_id
    WHERE se.mega_event_id = ? ORDER BY se.event_date, se.start_at`).all(m.id);
  res.json({ ...serializeMega(m), sub_events: subs.map((s) => serializeSub(s, { privileged: true })) });
});

router.post('/mega-events/:id/sub-events', requireAuth, requireRole('president'), (req, res) => {
  const m = loadMega(req.params.id);
  if (m.president_id !== req.user.id) throw new AppError(403, 'This Mega Event is not assigned to you.');
  const title = clean(req.body?.title);
  const description = clean(req.body?.description);
  const venue = clean(req.body?.venue);
  if (!title) throw new AppError(400, 'Sub-event title is required.');
  if (!description) throw new AppError(400, 'Sub-event description is required.');
  if (!venue) throw new AppError(400, 'Venue is required.');
  const times = subTimes(m, req.body ?? {});
  const supervisor = req.body?.supervisor_id ? requireStudent(req.body.supervisor_id) : null;

  let allocated = null;
  if (req.body?.allocated_budget !== undefined && req.body?.allocated_budget !== null && req.body?.allocated_budget !== '') {
    allocated = round2(Number(req.body.allocated_budget));
    if (!Number.isFinite(allocated) || allocated < 0) throw new AppError(400, 'Allocation must be 0 or more.');
    if (allocatedTotal(m.id) + allocated > m.overall_budget) {
      throw new AppError(400, `Allocations cannot exceed the overall budget of PKR ${m.overall_budget}.`);
    }
  }

  const now = nowIso();
  const id = Number(db.prepare(`
    INSERT INTO sub_events (mega_event_id, title, description, venue, event_date, start_at, end_at, supervisor_id, allocated_budget, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(m.id, title, description, venue, times.event_date, times.start_at, times.end_at,
    supervisor?.id ?? null, allocated, now, now).lastInsertRowid);

  if (supervisor) {
    notify([supervisor.id], { type: 'supervisor_assigned', message: `You were assigned as supervisor of "${title}" (${m.title}).`, link: '/student' });
    signal([supervisor.id], 'supervision');
  }
  signal([m.president_id], 'mega');
  res.status(201).json(serializeSub(loadSub(id), { privileged: true }));
});

router.patch('/sub-events/:id', requireAuth, requireRole('president'), (req, res) => {
  const s = loadSub(req.params.id);
  if (s.president_id !== req.user.id) throw new AppError(403, 'This sub-event is not part of your Mega Event.');
  const mega = loadMega(s.mega_event_id);
  const body = req.body ?? {};
  const title = 'title' in body ? clean(body.title) : s.title;
  const description = 'description' in body ? clean(body.description) : s.description;
  const venue = 'venue' in body ? clean(body.venue) : s.venue;
  if (!title || !description || !venue) throw new AppError(400, 'Title, description and venue are required.');
  const times = subTimes(mega, body, s);

  let supervisorId = s.supervisor_id;
  if ('supervisor_id' in body) {
    supervisorId = body.supervisor_id ? requireStudent(body.supervisor_id).id : null;
  }

  db.prepare(`UPDATE sub_events SET title = ?, description = ?, venue = ?, event_date = ?, start_at = ?, end_at = ?,
    supervisor_id = ?, updated_at = ? WHERE id = ?`)
    .run(title, description, venue, times.event_date, times.start_at, times.end_at, supervisorId, nowIso(), s.id);

  // Supervision moves immediately: the previous supervisor loses access, the new one gains it.
  if (supervisorId !== s.supervisor_id) {
    if (s.supervisor_id) notify([s.supervisor_id], { type: 'supervisor_removed', message: `You are no longer supervising "${title}".`, link: '/student' });
    if (supervisorId) notify([supervisorId], { type: 'supervisor_assigned', message: `You were assigned as supervisor of "${title}" (${mega.title}).`, link: '/student' });
    signal([s.supervisor_id, supervisorId].filter(Boolean), 'supervision');
  }
  signal([mega.president_id], 'mega');
  res.json(serializeSub(loadSub(s.id), { privileged: true }));
});

// Sets a sub-event's budget allocation. It is set once and the total must fit the overall budget.
router.post('/sub-events/:id/allocation', requireAuth, requireRole('president'), (req, res) => {
  const s = loadSub(req.params.id);
  if (s.president_id !== req.user.id) throw new AppError(403, 'This sub-event is not part of your Mega Event.');
  if (s.allocated_budget !== null && s.allocated_budget !== undefined) {
    throw new AppError(409, 'This sub-event already has its budget allocation. Allocations are set once.');
  }
  const amount = round2(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < 0) throw new AppError(400, 'Allocation must be 0 or more.');
  if (allocatedTotal(s.mega_event_id) + amount > s.overall_budget) {
    throw new AppError(400, `Allocations cannot exceed the overall budget of PKR ${s.overall_budget}. Remaining: PKR ${round2(s.overall_budget - allocatedTotal(s.mega_event_id))}.`);
  }
  db.prepare('UPDATE sub_events SET allocated_budget = ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), s.id);
  signal([s.president_id], 'mega');
  res.json(serializeSub(loadSub(s.id), { privileged: true }));
});

// Records an expense against a sub-event. No approval is needed. Spending may not exceed the allocation.
// Reaching 80% of the allocation notifies the president once, recorded with a stored flag.
router.post('/sub-events/:id/expenses', requireAuth, requireRole('president'), (req, res) => {
  const s = loadSub(req.params.id);
  if (s.president_id !== req.user.id) throw new AppError(403, 'This sub-event is not part of your Mega Event.');
  const description = clean(req.body?.description);
  if (!description) throw new AppError(400, 'Description is required.');
  const amount = round2(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, 'Amount must be greater than 0.');
  const category = clean(req.body?.category) || 'Other';
  if (!EXPENSE_CATEGORIES.includes(category)) throw new AppError(400, 'Choose a category from the list.');
  const vendor = clean(req.body?.vendor);
  const spentOn = DATE_RE.test(req.body?.spent_on ?? '') ? req.body.spent_on : pktDate();
  if (s.allocated_budget === null || s.allocated_budget === undefined) {
    throw new AppError(409, 'Set a budget allocation for this sub-event before recording expenses.');
  }

  const result = transaction(() => {
    const spentBefore = subSpent(s.id);
    if (round2(spentBefore + amount) > s.allocated_budget) {
      throw new AppError(400, `This expense exceeds the remaining allocation of PKR ${round2(s.allocated_budget - spentBefore)}.`);
    }
    const now = nowIso();
    db.prepare(`INSERT INTO expenses (sub_event_id, description, amount, spent_on, created_by, created_at, updated_at, category, vendor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(s.id, description, amount, spentOn, req.user.id, now, now, category, vendor);
    const spent = round2(spentBefore + amount);
    const crossedThreshold = s.allocated_budget > 0 && spent >= 0.8 * s.allocated_budget && !s.warned_80;
    if (crossedThreshold) {
      db.prepare('UPDATE sub_events SET warned_80 = 1, updated_at = ? WHERE id = ?').run(now, s.id);
    }
    return { spent, crossedThreshold };
  });

  if (result.crossedThreshold) {
    notify([req.user.id], {
      type: 'budget_threshold',
      message: `"${s.title}" has reached 80% of its budget allocation (PKR ${result.spent} of PKR ${s.allocated_budget}).`,
      link: `/president/mega/${s.mega_event_id}`,
    });
  }
  signal([req.user.id], 'mega');
  res.status(201).json(serializeSub(loadSub(s.id), { privileged: true }));
});

// Sub-event detail: the president sees budgets and expenses; the supervisor sees tasks only.
router.get('/sub-events/supervised', requireAuth, requireRole('student'), (req, res) => {
  const subs = db.prepare(`
    SELECT se.*, m.title AS mega_title, m.president_id, m.start_date AS mega_start, m.end_date AS mega_end,
      m.overall_budget, m.society_id, sup.name AS supervisor_name
    FROM sub_events se
    JOIN mega_events m ON m.id = se.mega_event_id
    LEFT JOIN users sup ON sup.id = se.supervisor_id
    WHERE se.supervisor_id = ? ORDER BY se.start_at`).all(req.user.id);
  res.json(subs.map((s) => ({ ...serializeSub(s, { privileged: false }), tasks: listSubTasks(s.id) })));
});

function listSubTasks(subId) {
  return db.prepare(`
    SELECT t.*, u.name AS assignee_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.sub_event_id = ? ORDER BY t.due_at, t.id`).all(subId);
}

router.get('/sub-events/:id', requireAuth, (req, res) => {
  const s = loadSub(req.params.id);
  const isPresident = req.user.role === 'president' && s.president_id === req.user.id;
  const isSupervisor = req.user.role === 'student' && s.supervisor_id === req.user.id;
  if (!isPresident && !isSupervisor) throw new AppError(403, 'Only the president or this sub-event’s supervisor can view it.');
  const out = { ...serializeSub(s, { privileged: isPresident }), tasks: listSubTasks(s.id) };
  if (isPresident) {
    out.expenses = db.prepare(`
      SELECT x.id, x.description, x.amount, x.category, x.vendor, x.spent_on, u.name AS recorded_by
      FROM expenses x LEFT JOIN users u ON u.id = x.created_by WHERE x.sub_event_id = ? ORDER BY x.spent_on DESC, x.id DESC`).all(s.id);
  }
  res.json(out);
});

router.post('/sub-events/:id/tasks', requireAuth, requireRole('president'), (req, res) => {
  const s = loadSub(req.params.id);
  if (s.president_id !== req.user.id) throw new AppError(403, 'This sub-event is not part of your Mega Event.');
  const title = clean(req.body?.title);
  if (!title) throw new AppError(400, 'Task title is required.');
  const priority = req.body?.priority ?? 'medium';
  if (!PRIORITIES.includes(priority)) throw new AppError(400, 'Priority must be low, medium, high or urgent.');
  const dueAt = req.body?.due_at ? pktToIso(req.body.due_at) : null;
  if (req.body?.due_at && !dueAt) throw new AppError(400, 'Due date must be a valid Pakistan time.');
  const assignee = req.body?.assignee_id ? requireStudent(req.body.assignee_id) : null;

  const now = nowIso();
  const id = Number(db.prepare(`
    INSERT INTO tasks (sub_event_id, title, description, priority, due_at, status, assignee_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?)`).run(s.id, title, clean(req.body?.description), priority, dueAt, assignee?.id ?? null, now, now).lastInsertRowid);

  if (assignee) {
    notify([assignee.id], { type: 'task_assigned', message: `You were assigned "${title}" for "${s.title}".`, link: '/student' });
    signal([assignee.id], 'tasks');
  }
  signal([s.president_id, s.supervisor_id].filter(Boolean), 'tasks');
  res.status(201).json({ id });
});

// ---------------------------------------------------------------------------
// Sub-event tasks. Task 1 tasks are passed on to the existing handlers.
// ---------------------------------------------------------------------------

const SUB_TASK_SELECT = `
  SELECT t.*, se.title AS sub_title, se.supervisor_id, se.mega_event_id, m.president_id, m.title AS mega_title
  FROM tasks t
  JOIN sub_events se ON se.id = t.sub_event_id
  JOIN mega_events m ON m.id = se.mega_event_id`;

router.patch('/tasks/:id', requireAuth, (req, res, next) => {
  const task = db.prepare(`${SUB_TASK_SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!task) return next(); // Task 1 task (or missing): handled by the event routes
  if (!task.sub_event_id) return next();

  const isPresident = req.user.id === task.president_id;
  const isSupervisor = req.user.id === task.supervisor_id;
  const isAssignee = req.user.id === task.assignee_id;
  if (!isPresident && !isSupervisor && !isAssignee) throw new AppError(403, 'You can update only tasks you are responsible for.');

  const body = req.body ?? {};
  const fieldKeys = Object.keys(body).filter((k) => k !== 'status');
  // Supervisors and assignees change status only. The president can edit every field.
  if (!isPresident && fieldKeys.length) throw new AppError(403, 'Only the status can be changed here.');

  const next_ = {
    title: task.title, description: task.description, priority: task.priority, due_at: task.due_at,
    status: task.status, assignee_id: task.assignee_id,
  };
  if (isPresident) {
    if ('title' in body) {
      next_.title = clean(body.title);
      if (!next_.title) throw new AppError(400, 'Task title is required.');
    }
    if ('description' in body) next_.description = clean(body.description);
    if ('priority' in body) {
      if (!PRIORITIES.includes(body.priority)) throw new AppError(400, 'Priority must be low, medium, high or urgent.');
      next_.priority = body.priority;
    }
    if ('due_at' in body) next_.due_at = body.due_at ? pktToIso(body.due_at) : null;
    if ('assignee_id' in body) next_.assignee_id = body.assignee_id ? requireStudent(body.assignee_id).id : null;
  }
  if ('status' in body) {
    if (!TASK_STATUSES.includes(body.status)) throw new AppError(400, 'Status must be todo, in_progress or completed.');
    next_.status = body.status;
  }

  db.prepare(`UPDATE tasks SET title = ?, description = ?, priority = ?, due_at = ?, status = ?, assignee_id = ?, updated_at = ?
    WHERE id = ?`).run(next_.title, next_.description, next_.priority, next_.due_at, next_.status, next_.assignee_id, nowIso(), task.id);

  if (next_.assignee_id && next_.assignee_id !== task.assignee_id) {
    notify([next_.assignee_id], { type: 'task_assigned', message: `You were assigned "${next_.title}" for "${task.sub_title}".`, link: '/student' });
  }
  if (next_.status !== task.status) {
    const label = STATUS_TEXT[next_.status];
    if (isPresident && task.assignee_id) {
      notify([task.assignee_id], { type: 'task_status', message: `"${next_.title}" was moved to ${label}.`, link: '/student' });
    } else if (!isPresident) {
      notify([task.president_id], { type: 'task_status', message: `${req.user.name} moved "${next_.title}" to ${label}.`, link: `/president/mega/${task.mega_event_id}` });
    }
  }
  signal([task.president_id, task.supervisor_id, task.assignee_id, next_.assignee_id].filter(Boolean), 'tasks');
  res.json({ ok: true });
});

router.delete('/tasks/:id', requireAuth, requireRole('president'), (req, res, next) => {
  const task = db.prepare(`${SUB_TASK_SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!task || !task.sub_event_id) return next();
  if (task.president_id !== req.user.id) throw new AppError(403, 'This task belongs to another Mega Event.');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  if (task.assignee_id) notify([task.assignee_id], { type: 'task_removed', message: `The task "${task.title}" was removed.`, link: '/student' });
  signal([task.president_id, task.supervisor_id, task.assignee_id].filter(Boolean), 'tasks');
  res.json({ ok: true });
});

// Student task list: Task 1 tasks and sub-event tasks assigned to the student.
router.get('/tasks/mine', requireAuth, requireRole('student'), (req, res) => {
  const event = db.prepare(`
    SELECT t.id, t.title, t.description, t.priority, t.due_at, t.status, t.assignee_id, t.created_at, t.updated_at,
      e.id AS event_id, e.title AS event_title, e.status AS event_status, s.name AS society_name, NULL AS sub_event_id
    FROM tasks t
    JOIN events e ON e.id = t.event_id
    JOIN societies s ON s.id = e.society_id
    WHERE t.assignee_id = ? AND t.sub_event_id IS NULL`).all(req.user.id);
  const sub = db.prepare(`
    SELECT t.id, t.title, t.description, t.priority, t.due_at, t.status, t.assignee_id, t.created_at, t.updated_at,
      NULL AS event_id, se.title AS event_title, NULL AS event_status, s.name AS society_name, se.id AS sub_event_id,
      m.title AS mega_title
    FROM tasks t
    JOIN sub_events se ON se.id = t.sub_event_id
    JOIN mega_events m ON m.id = se.mega_event_id
    JOIN societies s ON s.id = m.society_id
    WHERE t.assignee_id = ?`).all(req.user.id);
  const rows = [...event, ...sub].sort((a, b) => String(a.due_at ?? '').localeCompare(String(b.due_at ?? '')));
  res.json(rows);
});

export default router;
