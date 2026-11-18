import { Router } from 'express';
import { db, transaction } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { pktToIso, nowIso } from '../lib/domain.js';
import { notify, signal } from '../lib/realtime.js';

const router = Router();
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function loadSociety(id) {
  const s = db.prepare('SELECT * FROM societies WHERE id = ?').get(id);
  if (!s) throw new AppError(404, 'Society not found.');
  return s;
}

// Meeting with its society owner, for permission checks.
function loadMeeting(id) {
  const m = db.prepare(`
    SELECT m.*, s.owner_id, s.name AS society_name
    FROM meetings m JOIN societies s ON s.id = m.society_id WHERE m.id = ?`).get(id);
  if (!m) throw new AppError(404, 'Meeting not found.');
  return m;
}

function parseMeetingInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || 'title' in body) {
    out.title = clean(body.title);
    if (!out.title) throw new AppError(400, 'Meeting title is required.');
    if (out.title.length > 150) throw new AppError(400, 'Meeting title must be 150 characters or fewer.');
  }
  if (!partial || 'starts_at' in body) {
    out.starts_at = pktToIso(body.starts_at);
    if (!out.starts_at) throw new AppError(400, 'Date and time are required (Pakistan time).');
  }
  if (!partial || 'location' in body) out.location = clean(body.location);
  if (!partial || 'agenda' in body) out.agenda = clean(body.agenda);
  if (!partial || 'description' in body) out.description = clean(body.description);
  return out;
}

// Only approved members of the society can be invited.
function eligibleStudentIds(societyId, ids) {
  const valid = db.prepare("SELECT 1 FROM memberships WHERE society_id = ? AND student_id = ? AND status = 'approved'");
  return [...new Set((ids ?? []).map(Number).filter(Number.isInteger))].filter((id) => valid.get(societyId, id));
}

// Lists meetings for the society owner or an administrator, with invitation counts.
router.get('/societies/:id/meetings', requireAuth, (req, res) => {
  const society = loadSociety(req.params.id);
  if (society.owner_id !== req.user.id && req.user.role !== 'admin') {
    throw new AppError(403, 'Only the society president can view its meetings.');
  }
  const rows = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM meeting_invitations i WHERE i.meeting_id = m.id) AS invited_count,
      (SELECT COUNT(*) FROM meeting_invitations i WHERE i.meeting_id = m.id AND i.response = 'accepted') AS accepted_count
    FROM meetings m WHERE m.society_id = ? ORDER BY m.starts_at DESC`).all(society.id);
  res.json(rows);
});

// Creates a meeting and invites the chosen approved members.
router.post('/societies/:id/meetings', requireAuth, requireRole('president'), (req, res) => {
  const society = loadSociety(req.params.id);
  if (society.owner_id !== req.user.id) throw new AppError(403, 'You can manage only your own society.');
  const v = parseMeetingInput(req.body);
  const invitees = eligibleStudentIds(society.id, req.body?.student_ids);

  const id = transaction(() => {
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO meetings (society_id, title, description, location, agenda, starts_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`).run(society.id, v.title, v.description, v.location, v.agenda, v.starts_at, now, now);
    for (const studentId of invitees) {
      db.prepare('INSERT INTO meeting_invitations (meeting_id, student_id, created_at) VALUES (?, ?, ?)')
        .run(info.lastInsertRowid, studentId, now);
    }
    return Number(info.lastInsertRowid);
  });

  notify(invitees, {
    type: 'meeting_invitation',
    message: `${society.name} invited you to "${v.title}".`,
    link: '/student',
  });
  signal(invitees, 'meetings');
  res.status(201).json({ id, invited: invitees.length });
});

// Edits a meeting. Invitees are told when the time or place changes.
router.patch('/meetings/:id', requireAuth, requireRole('president'), (req, res) => {
  const m = loadMeeting(req.params.id);
  if (m.owner_id !== req.user.id) throw new AppError(403, 'You can manage only your own society meetings.');
  if (m.status === 'cancelled') throw new AppError(409, 'A cancelled meeting cannot be changed.');
  const v = parseMeetingInput(req.body, { partial: true });
  const next = { ...m, ...v };

  db.prepare(`
    UPDATE meetings SET title = ?, description = ?, location = ?, agenda = ?, starts_at = ?, updated_at = ? WHERE id = ?`)
    .run(next.title, next.description, next.location, next.agenda, next.starts_at, nowIso(), m.id);

  const invitees = db.prepare('SELECT student_id FROM meeting_invitations WHERE meeting_id = ?').all(m.id).map((r) => r.student_id);
  const changed = next.starts_at !== m.starts_at || next.location !== m.location || next.title !== m.title;
  if (changed) {
    notify(invitees, {
      type: 'meeting_updated',
      message: `"${next.title}" was updated. Check the new time or location.`,
      link: '/student',
    });
  }
  signal(invitees, 'meetings');
  res.json({ ok: true });
});

// Cancels a meeting. Invitees are notified.
router.post('/meetings/:id/cancel', requireAuth, requireRole('president'), (req, res) => {
  const m = loadMeeting(req.params.id);
  if (m.owner_id !== req.user.id) throw new AppError(403, 'You can manage only your own society meetings.');
  if (m.status === 'cancelled') throw new AppError(409, 'This meeting is already cancelled.');

  db.prepare("UPDATE meetings SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), m.id);
  const invitees = db.prepare('SELECT student_id FROM meeting_invitations WHERE meeting_id = ?').all(m.id).map((r) => r.student_id);
  notify(invitees, { type: 'meeting_cancelled', message: `"${m.title}" has been cancelled.`, link: '/student' });
  signal(invitees, 'meetings');
  res.json({ status: 'cancelled' });
});

// Adds more approved members to a scheduled meeting.
router.post('/meetings/:id/invitees', requireAuth, requireRole('president'), (req, res) => {
  const m = loadMeeting(req.params.id);
  if (m.owner_id !== req.user.id) throw new AppError(403, 'You can manage only your own society meetings.');
  if (m.status === 'cancelled') throw new AppError(409, 'This meeting is cancelled.');

  const already = new Set(db.prepare('SELECT student_id FROM meeting_invitations WHERE meeting_id = ?').all(m.id).map((r) => r.student_id));
  const fresh = eligibleStudentIds(m.society_id, req.body?.student_ids).filter((id) => !already.has(id));
  const now = nowIso();
  for (const studentId of fresh) {
    db.prepare('INSERT INTO meeting_invitations (meeting_id, student_id, created_at) VALUES (?, ?, ?)').run(m.id, studentId, now);
  }
  notify(fresh, { type: 'meeting_invitation', message: `You were invited to "${m.title}".`, link: '/student' });
  signal(fresh, 'meetings');
  res.json({ added: fresh.length });
});

// Students see the meetings they were invited to.
router.get('/meetings/mine', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.title, m.description, m.location, m.agenda, m.starts_at, m.status,
      s.name AS society_name, i.id AS invitation_id, i.response
    FROM meeting_invitations i
    JOIN meetings m ON m.id = i.meeting_id
    JOIN societies s ON s.id = m.society_id
    WHERE i.student_id = ? ORDER BY m.starts_at DESC`).all(req.user.id);
  res.json(rows);
});

// A student accepts or declines a meeting invitation. The president is told.
router.post('/meetings/invitations/:id/respond', requireAuth, requireRole('student'), (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, m.title, m.status AS meeting_status, s.owner_id
    FROM meeting_invitations i
    JOIN meetings m ON m.id = i.meeting_id
    JOIN societies s ON s.id = m.society_id
    WHERE i.id = ?`).get(req.params.id);
  if (!inv || inv.student_id !== req.user.id) throw new AppError(404, 'Invitation not found.');
  if (inv.meeting_status === 'cancelled') throw new AppError(409, 'This meeting was cancelled.');

  const response = req.body?.accept === true ? 'accepted' : 'declined';
  db.prepare('UPDATE meeting_invitations SET response = ?, responded_at = ? WHERE id = ?').run(response, nowIso(), inv.id);
  notify([inv.owner_id], {
    type: 'meeting_response',
    message: `${req.user.name} ${response} the invitation to "${inv.title}".`,
    link: '/president',
  });
  signal([inv.owner_id, req.user.id], 'meetings');
  res.json({ response });
});

export default router;
