import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { nowIso, pktToIso } from './domain.js';

// Starter data required by Task 2: the NEXUS society, its president and at least three registered students.
// Safe to run more than once: existing rows are reused and nothing is deleted.
export const NEXUS_PRESIDENT_EMAIL = 'nexus.president@unisphere.edu';
const STUDENTS = [
  { name: 'Ali Raza', email: 'ali@unisphere.edu' },
  { name: 'Sara Ahmed', email: 'sara@unisphere.edu' },
  { name: 'Bilal Shah', email: 'bilal@unisphere.edu' },
];

function ensureUser({ name, email, role, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 10), role);
  return Number(info.lastInsertRowid);
}

export function ensureNexusStarter({ password = process.env.DEMO_PASSWORD || 'Demo@12345' } = {}) {
  const presidentId = ensureUser({ name: 'NEXUS President', email: NEXUS_PRESIDENT_EMAIL, role: 'president', password });
  const studentIds = STUDENTS.map((s) => ensureUser({ ...s, role: 'student', password }));

  let society = db.prepare("SELECT id FROM societies WHERE name = 'NEXUS'").get();
  if (!society) {
    const info = db.prepare(`
      INSERT INTO societies (owner_id, name, description, category, contact_email, contact_phone, created_at)
      VALUES (?, 'NEXUS', 'Organisers of NEXUS Tech Fest: competitions, workshops and exhibitions.', 'Technology', 'nexus@unisphere.edu', '', ?)`)
      .run(presidentId, nowIso());
    society = { id: Number(info.lastInsertRowid) };
  }

  for (const studentId of studentIds) {
    const has = db.prepare('SELECT id FROM memberships WHERE society_id = ? AND student_id = ?').get(society.id, studentId);
    if (!has) {
      db.prepare("INSERT INTO memberships (society_id, student_id, status, created_at, decided_at) VALUES (?, ?, 'approved', ?, ?)")
        .run(society.id, studentId, nowIso(), nowIso());
    }
  }

  return { presidentId, studentIds, societyId: society.id };
}

// Demo Mega Event for NEXUS Tech Fest: two sub-events with supervisors, tasks and allocations.
// Created only if it does not already exist.
export function ensureNexusDemoMegaEvent(adminId) {
  const { presidentId, studentIds, societyId } = ensureNexusStarter();
  const existing = db.prepare("SELECT id FROM mega_events WHERE title = 'NEXUS Tech Fest 2026' AND society_id = ?").get(societyId);
  if (existing) return existing.id;

  const now = nowIso();
  const megaId = Number(db.prepare(`
    INSERT INTO mega_events (title, description, society_id, president_id, created_by, start_date, end_date, overall_budget, created_at, updated_at)
    VALUES ('NEXUS Tech Fest 2026', 'A two-day technology fest with a gaming competition, a web development workshop, a quiz and a project exhibition.',
            ?, ?, ?, '2026-12-10', '2026-12-11', 100000, ?, ?)`).run(societyId, presidentId, adminId, now, now).lastInsertRowid);

  const subs = [
    { title: 'Gaming Competition', description: 'Team tournament on campus consoles.', venue: 'Computer Lab 1', date: '2026-12-10', start: '10:00', end: '13:00', supervisor: studentIds[0], allocated: 35000 },
    { title: 'Web Development Workshop', description: 'Hands-on React and Node.js session.', venue: 'Seminar Hall A', date: '2026-12-11', start: '14:00', end: '17:00', supervisor: studentIds[1], allocated: 30000 },
  ];
  for (const s of subs) {
    const subId = Number(db.prepare(`
      INSERT INTO sub_events (mega_event_id, title, description, venue, event_date, start_at, end_at, supervisor_id, allocated_budget, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(megaId, s.title, s.description, s.venue, s.date,
      pktToIso(`${s.date}T${s.start}`), pktToIso(`${s.date}T${s.end}`), s.supervisor, s.allocated, now, now).lastInsertRowid);
    db.prepare(`INSERT INTO tasks (sub_event_id, title, description, priority, due_at, status, assignee_id, created_at, updated_at)
      VALUES (?, 'Book equipment', 'Confirm consoles and power.', 'high', ?, 'completed', ?, ?, ?)`)
      .run(subId, pktToIso(`${s.date}T09:00`), studentIds[2], now, now);
    db.prepare(`INSERT INTO tasks (sub_event_id, title, description, priority, due_at, status, assignee_id, created_at, updated_at)
      VALUES (?, 'Prepare rules and brackets', 'Publish rules one week before.', 'medium', ?, 'in_progress', NULL, ?, ?)`)
      .run(subId, pktToIso(`${s.date}T09:00`), now, now);
  }
  return megaId;
}
