// Resets the database and loads demo data, including the administrator account.
// Usage: npm run seed
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { ensureNexusStarter, ensureNexusDemoMegaEvent, NEXUS_PRESIDENT_EMAIL } from './lib/nexusSeed.js';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@unisphere.edu';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';

const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const days = (d) => hours(d * 24);

// Clear in dependency order (foreign keys are enforced).
for (const table of [
  'notifications', 'expenses', 'tasks', 'sub_events', 'mega_events', 'meeting_invitations', 'meetings',
  'invitations', 'registrations', 'events', 'memberships', 'societies', 'otp_codes', 'users',
]) {
  db.exec(`DELETE FROM ${table}`);
}

const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');

const adminId = Number(insertUser.run('UniSphere Administrator', ADMIN_EMAIL, adminHash, 'admin').lastInsertRowid);
const president = insertUser.run('Ayesha Khan', 'president@unisphere.edu', hash, 'president').lastInsertRowid;
const ali = insertUser.run('Ali Raza', 'ali@unisphere.edu', hash, 'student').lastInsertRowid;
const sara = insertUser.run('Sara Ahmed', 'sara@unisphere.edu', hash, 'student').lastInsertRowid;
const bilal = insertUser.run('Bilal Shah', 'bilal@unisphere.edu', hash, 'student').lastInsertRowid;

const society = db.prepare(`
  INSERT INTO societies (owner_id, name, description, category, contact_email, contact_phone)
  VALUES (?, 'Tech Circle', 'A community for coding, AI and hackathons on campus.', 'Technology', 'techcircle@unisphere.edu', '+92 300 1234567')
`).run(president).lastInsertRowid;

const addMembership = db.prepare('INSERT INTO memberships (society_id, student_id, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?)');
addMembership.run(society, ali, 'approved', days(-30), days(-29));
addMembership.run(society, sara, 'pending', hours(-2), null);

const insertEvent = db.prepare(`
  INSERT INTO events (society_id, title, description, venue, start_at, end_at, registration_deadline,
                      capacity, proposed_budget, approved_budget, status, remarks, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const now = new Date().toISOString();

const aiWorkshop = insertEvent.run(society, 'AI Workshop: Intro to LLMs',
  'A hands-on session on prompt design and building small AI tools.', 'Seminar Hall A',
  days(5), hours(5 * 24 + 3), days(4), 30, 50000, 50000, 'approved', 'Approved. Good plan.', now, now).lastInsertRowid;

const hackathon = insertEvent.run(society, 'Campus Hackathon 2026',
  '24-hour build sprint in teams of three.', 'Computer Lab 2',
  hours(-1), hours(6), hours(-48), 40, 80000, 80000, 'approved', 'Approved.', now, now).lastInsertRowid;

insertEvent.run(society, 'Web Development Bootcamp',
  'Three evenings of React and Node.js basics.', 'Room 204',
  days(10), hours(10 * 24 + 3), days(9), 25, 30000, null, 'pending', '', now, now);

insertEvent.run(society, 'Robotics Seminar (Draft)',
  'Introduction to robotics and microcontrollers.', 'Auditorium',
  days(20), hours(20 * 24 + 2), days(19), 100, 60000, null, 'draft', '', now, now);

insertEvent.run(society, 'Git and GitHub Meetup',
  'Branching, pull requests and code review.', 'Library Lounge',
  days(-10), hours(-10 * 24 + 2), days(-11), 20, 5000, 5000, 'approved', 'Approved.', now, now);

// Registrations and volunteers for the demo.
db.prepare("INSERT INTO registrations (event_id, student_id, status, created_at, updated_at) VALUES (?, ?, 'registered', ?, ?)")
  .run(aiWorkshop, ali, now, now);
db.prepare("INSERT INTO registrations (event_id, student_id, status, created_at, updated_at) VALUES (?, ?, 'registered', ?, ?)")
  .run(hackathon, sara, now, now);

db.prepare("INSERT INTO invitations (event_id, student_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
  .run(hackathon, ali, days(-3), days(-2));
db.prepare("INSERT INTO invitations (event_id, student_id, status, created_at) VALUES (?, ?, 'invited', ?)")
  .run(aiWorkshop, bilal, now);

const insertTask = db.prepare(`
  INSERT INTO tasks (event_id, title, description, priority, due_at, status, assignee_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insertTask.run(hackathon, 'Set up registration desk', 'Check-in list and name badges.', 'high', hours(-1), 'in_progress', ali, now, now);
insertTask.run(hackathon, 'Book judges', 'Confirm three industry judges.', 'medium', hours(-2), 'completed', null, now, now);
insertTask.run(hackathon, 'Prepare problem statements', 'Five problem statements for teams.', 'low', hours(-3), 'todo', null, now, now);

const insertExpense = db.prepare('INSERT INTO expenses (event_id, description, amount, spent_on, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
insertExpense.run(hackathon, 'Venue hire', 15000, now.slice(0, 10), president, now, now);
insertExpense.run(hackathon, 'Snacks and drinks', 12500, now.slice(0, 10), president, now, now);

// Task 2 starter data: the NEXUS society, its president, three students, and a demo Mega Event
// (NEXUS Tech Fest 2026) with two sub-events, supervisors, checklist tasks and allocations.
ensureNexusStarter({ password: DEMO_PASSWORD });
ensureNexusDemoMegaEvent(adminId);

console.log('Demo data loaded.\n');
console.log('Accounts (password for demo users is DEMO_PASSWORD):');
console.log(`  Administrator : ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
console.log(`  President     : president@unisphere.edu  /  ${DEMO_PASSWORD}`);
console.log(`  Student       : ali@unisphere.edu  /  ${DEMO_PASSWORD}`);
console.log(`  Student       : sara@unisphere.edu  /  ${DEMO_PASSWORD}`);
console.log(`  Student       : bilal@unisphere.edu  /  ${DEMO_PASSWORD}`);
console.log(`  NEXUS president (Task 2): ${NEXUS_PRESIDENT_EMAIL}  /  ${DEMO_PASSWORD}`);
