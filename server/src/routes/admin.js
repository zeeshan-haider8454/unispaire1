import { Router } from 'express';
import { db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { nowIso, round2 } from '../lib/domain.js';
import { EVENT_SELECT, loadEvent, serializeEvent } from '../lib/events.js';
import { notify, emitEvent, signal, adminIds } from '../lib/realtime.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const count = (sql, ...params) => db.prepare(sql).get(...params).n;

router.get('/dashboard', (req, res) => {
  const stats = {
    societies: count('SELECT COUNT(*) AS n FROM societies'),
    events: count('SELECT COUNT(*) AS n FROM events'),
    registrations: count("SELECT COUNT(*) AS n FROM registrations WHERE status = 'registered'"),
    pending: count("SELECT COUNT(*) AS n FROM events WHERE status IN ('pending', 'draft')"),
    approved: count("SELECT COUNT(*) AS n FROM events WHERE status = 'approved' AND end_at > ?", nowIso()),
  };
  // Drafts are included so administrators can approve or reject them directly.
  const pending = db.prepare(`${EVENT_SELECT} WHERE e.status IN ('pending', 'draft') ORDER BY e.start_at`)
    .all()
    .map((ev) => serializeEvent(ev, req.user));
  res.json({ stats, pending });
});

router.get('/events', (req, res) => {
  const status = req.query.status;
  const filter = ['draft', 'pending', 'approved', 'rejected', 'cancelled'].includes(status) ? 'WHERE e.status = ?' : '';
  const rows = db.prepare(`${EVENT_SELECT} ${filter} ORDER BY e.start_at DESC`).all(...(filter ? [status] : []));
  res.json(rows.map((ev) => serializeEvent(ev, req.user)));
});

// All accounts with their fixed role. Password hashes are never selected.
// Roles are immutable per the brief, so this endpoint is read-only.
router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY role, created_at DESC').all();
  res.json(rows);
});

const ROLE_LABELS = { admin: 'Administrator', president: 'Society President / Organizer', student: 'Student / Volunteer' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin edits a user's name, email and role. Safeguards stop an admin from locking the university out.
router.patch('/users/:id', (req, res) => {
  const target = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw new AppError(404, 'User not found.');

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : target.name;
  const email = req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : target.email;
  const role = req.body?.role ?? target.role;

  if (!name) throw new AppError(400, 'Name is required.');
  if (!EMAIL_RE.test(email)) throw new AppError(400, 'Enter a valid email address.');
  if (!ROLE_LABELS[role]) throw new AppError(400, 'Choose a valid role.');
  if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, target.id)) {
    throw new AppError(409, 'Another account already uses this email.');
  }

  if (target.role === 'admin' && role !== 'admin') {
    if (target.id === req.user.id) throw new AppError(409, 'You cannot remove your own administrator role.');
    const otherAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ?").get(target.id).n;
    if (otherAdmins === 0) throw new AppError(409, 'At least one administrator must remain.');
  }

  if (target.role === 'president' && role !== 'president' && db.prepare('SELECT id FROM societies WHERE owner_id = ?').get(target.id)) {
    throw new AppError(409, 'This president owns a society. Remove or hand over the society before changing the role.');
  }

  db.prepare('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?').run(name, email, role, target.id);

  if (role !== target.role) {
    notify([target.id], {
      type: 'role_changed',
      message: `An administrator changed your account role to ${ROLE_LABELS[role]}.`,
      link: '/',
    });
    signal([target.id], 'role');
  }
  signal(adminIds(), 'admin');

  res.json(db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(target.id));
});

router.get('/societies', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.category, s.created_at, u.name AS president_name, u.email AS president_email,
      (SELECT COUNT(*) FROM memberships m WHERE m.society_id = s.id AND m.status = 'approved') AS members,
      (SELECT COUNT(*) FROM events e WHERE e.society_id = s.id) AS events
    FROM societies s JOIN users u ON u.id = s.owner_id
    ORDER BY s.created_at DESC`).all();
  res.json(rows);
});

// Approve confirms the event and its proposed budget together. Reject needs remarks.
// After the start time has passed, a pending proposal can only be rejected.
router.post('/events/:id/decision', (req, res) => {
  const ev = loadEvent(req.params.id);
  if (!['pending', 'draft'].includes(ev.status)) throw new AppError(409, 'Only draft or pending event proposals can be decided.');

  const decision = req.body?.decision;
  if (!['approve', 'reject'].includes(decision)) throw new AppError(400, 'Decision must be approve or reject.');
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() : '';

  if (decision === 'approve' && Date.now() >= Date.parse(ev.start_at)) {
    throw new AppError(409, 'The start time has passed, so this proposal can only be rejected.');
  }
  if (decision === 'reject' && !remarks) throw new AppError(400, 'Remarks are required when rejecting a proposal.');

  // The approved amount defaults to the proposed budget. An administrator can enter a different amount when approving.
  let approvedBudget = ev.proposed_budget;
  if (decision === 'approve' && req.body?.approved_budget !== undefined && req.body?.approved_budget !== null && req.body?.approved_budget !== '') {
    approvedBudget = Number(req.body.approved_budget);
    if (!Number.isFinite(approvedBudget) || approvedBudget < 0) {
      throw new AppError(400, 'Approved budget must be 0 or more.');
    }
    approvedBudget = round2(approvedBudget);
  }

  const now = nowIso();
  let message;
  if (decision === 'approve') {
    db.prepare("UPDATE events SET status = 'approved', approved_budget = ?, remarks = ?, updated_at = ? WHERE id = ?")
      .run(approvedBudget, remarks, now, ev.id);
    message = `"${ev.title}" was approved with a budget of PKR ${approvedBudget}.`;
  } else {
    db.prepare("UPDATE events SET status = 'rejected', remarks = ?, updated_at = ? WHERE id = ?").run(remarks, now, ev.id);
    message = `"${ev.title}" was rejected: ${remarks}`;
  }

  notify([ev.owner_id], { type: 'event_decision', message, link: `/president/events/${ev.id}` });
  emitEvent(ev.id, { status: decision === 'approve' ? 'approved' : 'rejected' });
  signal([ev.owner_id, ...adminIds()], 'admin');
  res.json(serializeEvent(loadEvent(ev.id), req.user));
});

export default router;
