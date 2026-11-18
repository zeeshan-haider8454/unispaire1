import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, 'unisphere.db'));
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'president', 'student')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  invalidated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS societies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request
  ON memberships(society_id, student_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  registration_deadline TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  proposed_budget REAL NOT NULL CHECK (proposed_budget >= 0),
  approved_budget REAL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('registered', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, student_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  responded_at TEXT,
  UNIQUE (event_id, student_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'completed')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  spent_on TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`);

// Migration for databases created before password reset existed: OTP codes record their purpose.
const otpColumns = db.prepare('PRAGMA table_info(otp_codes)').all();
if (!otpColumns.some((c) => c.name === 'purpose')) {
  db.exec("ALTER TABLE otp_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'");
}

// Meetings: society meetings with invited members. Created here so existing databases get them too.
db.exec(`
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  agenda TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL DEFAULT 'invited' CHECK (response IN ('invited', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  responded_at TEXT,
  UNIQUE (meeting_id, student_id)
);
`);

// Migration: tasks gain an 'urgent' priority. Nothing references tasks, so the table can be rebuilt safely.
const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get();
if (taskSchema && !taskSchema.sql.includes("'urgent'")) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'completed')),
        assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tasks_new (id, event_id, title, description, priority, due_at, status, assignee_id, created_at, updated_at)
        SELECT id, event_id, title, description, priority, due_at, status, assignee_id, created_at, updated_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Migration: expenses are grouped by category and can name a vendor.
const expenseCols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name);
if (!expenseCols.includes('category')) db.exec("ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'");
if (!expenseCols.includes('vendor')) db.exec("ALTER TABLE expenses ADD COLUMN vendor TEXT NOT NULL DEFAULT ''");

// Migration: accepted volunteers can withdraw, so invitations need a 'withdrawn' status.
// Nothing references invitations, so the table can be rebuilt without touching other data.
const invitationSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invitations'").get();
if (invitationSchema && !invitationSchema.sql.includes("'withdrawn'")) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE invitations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'declined', 'withdrawn')),
        created_at TEXT NOT NULL,
        responded_at TEXT,
        UNIQUE (event_id, student_id)
      );
      INSERT INTO invitations_new (id, event_id, student_id, status, created_at, responded_at)
        SELECT id, event_id, student_id, status, created_at, responded_at FROM invitations;
      DROP TABLE invitations;
      ALTER TABLE invitations_new RENAME TO invitations;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Migration: approved members can be labelled Member or Core Member. The label is informational only.
const membershipColumns = db.prepare('PRAGMA table_info(memberships)').all().map((c) => c.name);
if (!membershipColumns.includes('label')) {
  db.exec("ALTER TABLE memberships ADD COLUMN label TEXT NOT NULL DEFAULT 'member'");
}

// Migration: expenses can carry a receipt file. Files live in server/uploads/receipts; the DB stores the stored name.
const expenseColumns = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name);
for (const [column, type] of [['receipt_file', 'TEXT'], ['receipt_name', 'TEXT'], ['receipt_mime', 'TEXT']]) {
  if (!expenseColumns.includes(column)) db.exec(`ALTER TABLE expenses ADD COLUMN ${column} ${type}`);
}

// Migration: a president may own several societies, so drop the UNIQUE constraint on societies.owner_id.
// Foreign keys are switched off during the rebuild, so events and memberships are not cascade-deleted.
const societySchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'societies'").get();
if (societySchema && /owner_id INTEGER NOT NULL UNIQUE/.test(societySchema.sql)) {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE societies_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        contact_email TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO societies_new (id, owner_id, name, description, category, contact_email, contact_phone, created_at)
        SELECT id, owner_id, name, description, category, contact_email, contact_phone, created_at FROM societies;
      DROP TABLE societies;
      ALTER TABLE societies_new RENAME TO societies;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// Runs fn inside a write transaction. node:sqlite is synchronous, so this also
// serialises concurrent registrations (capacity checks cannot interleave).
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
