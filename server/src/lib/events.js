import { db } from '../db.js';
import { AppError } from './errors.js';
import { eventFlags, round2, progressPercent } from './domain.js';

export const EVENT_SELECT = `
  SELECT e.*, s.owner_id, s.name AS society_name
  FROM events e JOIN societies s ON s.id = e.society_id`;

export function loadEvent(id) {
  const ev = db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id);
  if (!ev) throw new AppError(404, 'Event not found.');
  return ev;
}

export function countRegistered(eventId) {
  return db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'registered'").get(eventId).n;
}

export function eventStats(eventId) {
  const registered = countRegistered(eventId);
  const spent = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE event_id = ?').get(eventId).total;
  const tasks = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(status = 'completed'), 0) AS done
    FROM tasks WHERE event_id = ?`).get(eventId);
  return {
    registered,
    spent: round2(spent),
    taskTotal: tasks.total,
    taskDone: tasks.done,
  };
}

// Owner and administrators see budgets, remarks and task progress. Everyone else sees public details only.
export function canSeeAll(user, ev) {
  return Boolean(user && (user.role === 'admin' || user.id === ev.owner_id));
}

export function serializeEvent(ev, viewer = null) {
  const stats = eventStats(ev.id);
  const { schedule_status, budget_remaining, actions } = eventFlags(ev, {
    registered: stats.registered,
    spent: stats.spent,
  });

  const out = {
    id: ev.id,
    society_id: ev.society_id,
    society_name: ev.society_name,
    title: ev.title,
    description: ev.description,
    venue: ev.venue,
    start_at: ev.start_at,
    end_at: ev.end_at,
    registration_deadline: ev.registration_deadline,
    capacity: ev.capacity,
    status: ev.status,
    schedule_status,
    registered_count: stats.registered,
    seats_remaining: Math.max(ev.capacity - stats.registered, 0),
    actions,
  };

  if (canSeeAll(viewer, ev)) {
    Object.assign(out, {
      owner_id: ev.owner_id,
      remarks: ev.remarks,
      proposed_budget: ev.proposed_budget,
      approved_budget: ev.approved_budget,
      spent: stats.spent,
      budget_remaining,
      task_total: stats.taskTotal,
      task_done: stats.taskDone,
      progress: progressPercent(stats.taskDone, stats.taskTotal),
    });
  }
  return out;
}
