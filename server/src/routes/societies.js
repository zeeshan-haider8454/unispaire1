import { Router } from 'express';
import { db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { CATEGORIES, nowIso } from '../lib/domain.js';
import { EVENT_SELECT, serializeEvent } from '../lib/events.js';
import { notify, signal } from '../lib/realtime.js';

const router = Router();
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SOCIETY_SELECT = `
  SELECT s.*, u.name AS president_name,
    (SELECT COUNT(*) FROM memberships m WHERE m.society_id = s.id AND m.status = 'approved') AS member_count
  FROM societies s JOIN users u ON u.id = s.owner_id`;

function loadSociety(id) {
  const society = db.prepare(`${SOCIETY_SELECT} WHERE s.id = ?`).get(id);
  if (!society) throw new AppError(404, 'Society not found.');
  return society;
}

function parseSocietyInput(body = {}) {
  const name = clean(body.name);
  const description = clean(body.description);
  const category = body.category;
  const contact_email = clean(body.contact_email);
  const contact_phone = clean(body.contact_phone);

  if (!name) throw new AppError(400, 'Society name is required.');
  if (name.length > 100) throw new AppError(400, 'Society name must be 100 characters or fewer.');
  if (!CATEGORIES.includes(category)) throw new AppError(400, 'Choose a category from the list.');
  if (contact_email && !EMAIL_RE.test(contact_email)) throw new AppError(400, 'Contact email is not valid.');
  return { name, description, category, contact_email, contact_phone };
}

router.get('/categories', (req, res) => {
  res.json(CATEGORIES);
});

// Browsing requires login.
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.description, s.category, s.created_at, u.name AS president_name,
      (SELECT COUNT(*) FROM memberships m WHERE m.society_id = s.id AND m.status = 'approved') AS member_count,
      (SELECT m.status FROM memberships m WHERE m.society_id = s.id AND m.student_id = ? ORDER BY m.id DESC LIMIT 1) AS my_status
    FROM societies s JOIN users u ON u.id = s.owner_id
    ORDER BY s.name`).all(req.user.id);
  res.json(rows);
});

router.get('/memberships/mine', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.status, m.created_at, m.decided_at, s.id AS society_id, s.name AS society_name
    FROM memberships m JOIN societies s ON s.id = m.society_id
    WHERE m.student_id = ? ORDER BY m.created_at DESC`).all(req.user.id);
  res.json(rows);
});

// All societies owned by the signed-in president.
router.get('/mine', requireAuth, requireRole('president'), (req, res) => {
  const rows = db.prepare(`${SOCIETY_SELECT} WHERE s.owner_id = ? ORDER BY s.created_at`).all(req.user.id);
  res.json(rows);
});

router.post('/', requireAuth, requireRole('president'), (req, res) => {
  const input = parseSocietyInput(req.body);
  if (db.prepare('SELECT id FROM societies WHERE name = ?').get(input.name)) {
    throw new AppError(409, 'A society with this name already exists.');
  }
  const info = db.prepare(`
    INSERT INTO societies (owner_id, name, description, category, contact_email, contact_phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, input.name, input.description, input.category,
    input.contact_email, input.contact_phone, nowIso());
  res.status(201).json(loadSociety(info.lastInsertRowid));
});

router.get('/:id', requireAuth, (req, res) => {
  const society = loadSociety(req.params.id);
  const isOwner = society.owner_id === req.user.id;

  const events = db.prepare(`${EVENT_SELECT} WHERE e.society_id = ? AND e.status = 'approved' AND e.end_at > ? ORDER BY e.start_at`)
    .all(society.id, nowIso())
    .map((ev) => serializeEvent(ev, req.user));

  const my = db.prepare('SELECT status FROM memberships WHERE society_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1')
    .get(society.id, req.user.id);

  const out = { ...society, events, my_status: my?.status ?? null };
  if (isOwner || req.user.role === 'admin') {
    out.members = db.prepare(`
      SELECT m.id, m.status, m.created_at, u.id AS student_id, u.name, u.email
      FROM memberships m JOIN users u ON u.id = m.student_id
      WHERE m.society_id = ? ORDER BY m.created_at DESC`).all(society.id);
  }
  res.json(out);
});

router.put('/:id', requireAuth, requireRole('president'), (req, res) => {
  const society = loadSociety(req.params.id);
  if (society.owner_id !== req.user.id) throw new AppError(403, 'You can manage only your own society.');
  const input = parseSocietyInput(req.body);
  if (db.prepare('SELECT id FROM societies WHERE name = ? AND id != ?').get(input.name, society.id)) {
    throw new AppError(409, 'A society with this name already exists.');
  }
  db.prepare('UPDATE societies SET name = ?, description = ?, category = ?, contact_email = ?, contact_phone = ? WHERE id = ?')
    .run(input.name, input.description, input.category, input.contact_email, input.contact_phone, society.id);
  res.json(loadSociety(society.id));
});

// Students request membership. Only one pending request per student and society is allowed.
router.post('/:id/membership-requests', requireAuth, requireRole('student'), (req, res) => {
  const society = loadSociety(req.params.id);
  const current = db.prepare('SELECT status FROM memberships WHERE society_id = ? AND student_id = ? AND status IN (?, ?) ORDER BY id DESC LIMIT 1')
    .get(society.id, req.user.id, 'approved', 'pending');
  if (current?.status === 'approved') throw new AppError(409, 'You are already a member of this society.');
  if (current?.status === 'pending') throw new AppError(409, 'You already have a pending request for this society.');

  db.prepare("INSERT INTO memberships (society_id, student_id, status, created_at) VALUES (?, ?, 'pending', ?)")
    .run(society.id, req.user.id, nowIso());
  notify([society.owner_id], {
    type: 'membership_request',
    message: `${req.user.name} requested to join ${society.name}.`,
    link: '/president',
  });
  signal([society.owner_id], 'memberships');
  res.status(201).json({ status: 'pending' });
});

router.get('/:id/memberships', requireAuth, (req, res) => {
  const society = loadSociety(req.params.id);
  if (society.owner_id !== req.user.id && req.user.role !== 'admin') {
    throw new AppError(403, 'Only the society president can view membership requests.');
  }
  const rows = db.prepare(`
    SELECT m.id, m.status, m.label, m.created_at, m.decided_at, u.id AS student_id, u.name, u.email
    FROM memberships m JOIN users u ON u.id = m.student_id
    WHERE m.society_id = ? ORDER BY m.created_at DESC`).all(society.id);
  res.json(rows);
});

// action: approve | reject (pending requests), remove (approved members)
const ACTIONS = {
  approve: { from: 'pending', to: 'approved' },
  reject: { from: 'pending', to: 'rejected' },
  remove: { from: 'approved', to: 'removed' },
};

router.patch('/:id/memberships/:membershipId', requireAuth, requireRole('president'), (req, res) => {
  const society = loadSociety(req.params.id);
  if (society.owner_id !== req.user.id) throw new AppError(403, 'You can manage only your own society.');

  const membership = db.prepare('SELECT * FROM memberships WHERE id = ? AND society_id = ?').get(req.params.membershipId, society.id);
  if (!membership) throw new AppError(404, 'Membership request not found.');

  // Labels apply to approved members only. A label grants no extra permissions.
  if (req.body?.action === 'label') {
    const label = req.body?.label;
    if (!['member', 'core'].includes(label)) throw new AppError(400, 'Label must be member or core.');
    if (membership.status !== 'approved') throw new AppError(409, 'Only approved members can be labelled.');
    db.prepare('UPDATE memberships SET label = ? WHERE id = ?').run(label, membership.id);
    signal([membership.student_id], 'memberships');
    return res.json({ label });
  }

  const action = ACTIONS[req.body?.action];
  if (!action) throw new AppError(400, 'Action must be approve, reject or remove.');
  if (membership.status !== action.from) throw new AppError(409, 'This request cannot be changed in its current state.');

  db.prepare('UPDATE memberships SET status = ?, decided_at = ? WHERE id = ?').run(action.to, nowIso(), membership.id);

  const messages = {
    approved: `Your request to join ${society.name} was approved.`,
    rejected: `Your request to join ${society.name} was rejected.`,
    removed: `You were removed from ${society.name}.`,
  };
  notify([membership.student_id], { type: 'membership_decision', message: messages[action.to], link: `/societies/${society.id}` });
  signal([membership.student_id], 'memberships');
  res.json({ status: action.to });
});

export default router;
