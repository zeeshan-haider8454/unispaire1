# UniSphere

A university society and event management platform. Society presidents run their societies, events, volunteers, tasks, budgets and meetings. Students discover societies and events, register, volunteer and supervise activities. University administrators approve event proposals and budgets, create Mega Events and monitor activity across campus.

This repository covers **Task 1** (core platform and bonus features) and **Task 2** (Mega Event Management extension).

**Stack:** React 19 (Vite) · Node.js 22 · Express 5 · SQLite (built-in `node:sqlite`) · Socket.IO · JWT · bcrypt · Nodemailer · PDFKit · Multer

---

## Setup

**Requirements:** Node.js **22.13 or newer** (uses the built-in `node:sqlite` module). Check with `node -v`.

### 1. API

```bash
cd server
npm install
cp .env.example .env   # then edit the values (see below)
npm run seed           # creates the database, demo data, the administrator and the Task 2 starter data
npm run dev            # API on http://localhost:4000
```

### 2. Client

In a second terminal:

```bash
cd client
npm install
npm run dev            # app on http://localhost:5173
```

The Vite dev server proxies `/api` and `/socket.io` to the API.

**Single origin (optional):** `cd client && npm run build`, then `cd ../server && npm start` serves the app and API together on http://localhost:4000.

### Environment variables (`server/.env`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | API port | `4000` |
| `JWT_SECRET` | Signs session tokens. **Set a long random value.** | development fallback |
| `DB_PATH` | SQLite file | `server/data/unisphere.db` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email for login and reset codes (Gmail needs an App Password) | Gmail, port 465 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Administrator created by `npm run seed` | `admin@unisphere.edu` / `Admin@12345` |
| `DEMO_PASSWORD` | Password for seeded demo users | `Demo@12345` |

`.env` is git-ignored. Never commit real passwords, App Passwords or API keys.

---

## Test accounts (created by `npm run seed`)

Demo values only. Change them before any real use.

| Role | Email | Password |
| --- | --- | --- |
| University Administrator | `admin@unisphere.edu` (or `ADMIN_EMAIL`) | `Admin@12345` (or `ADMIN_PASSWORD`) |
| Society President (Tech Circle) | `president@unisphere.edu` | `Demo@12345` |
| Society President (NEXUS, Task 2) | `nexus.president@unisphere.edu` | `Demo@12345` |
| Student / Volunteer | `ali@unisphere.edu` | `Demo@12345` |
| Student / Volunteer | `sara@unisphere.edu` | `Demo@12345` |
| Student / Volunteer | `bilal@unisphere.edu` | `Demo@12345` |

The administrator is created only by the seed. Public signup offers Student and President roles only.

### Email OTP

Every login, registration and password reset sends a new six-digit code **to the email address entered by the user**. The sender is `SMTP_USER`. Codes expire after 10 minutes, allow five wrong attempts, have a 60-second resend cooldown, and a new code invalidates the old one.

If `SMTP_PASS` is empty, codes are printed to the API console instead (`[UniSphere LOGIN OTP] user@example.com -> 123456`). The login screen states which mode the server is in. Demo `@unisphere.edu` addresses cannot receive mail, so with SMTP enabled, register with a real address to test delivery.

---

## Task 1: features

**Authentication and roles**
- Signup (Student or President), login with password and email OTP, password reset by email OTP.
- Role guards on every API route and page. Rate limit on auth endpoints: 30 requests per IP per 15 minutes.
- Logged-out visitors who press Register on a public event keep their destination through signup, login and OTP.

**Societies and membership**
- Societies with name, description, fixed category list, contact details and logo (JPG/PNG/WebP up to 2 MB). Active immediately.
- Membership requests: one pending request per student and society (unique index), approve, reject, remove, request again after rejection or removal. Member / Core Member labels (label only).
- Public-facing society profile with member count, upcoming events and contact links (login required, per the brief).

**Events**
- Create, edit, submit and cancel events. Validation: start before end, deadline on or before start, capacity ≥ 1, budget ≥ 0, capacity not below active registrations.
- Times entered in **Pakistan Standard Time (Asia/Karachi)**, stored in UTC, displayed in PKT.
- Approval status (Draft, Pending, Approved, Rejected, Cancelled) is separate from schedule status (Upcoming, Ongoing, Completed), which is computed from the clock. Allowed actions follow the Event Status Table.
- Editing an approved event returns it to Pending; the last approved budget stays in force. Cancellation is irreversible and keeps registrations as Cancelled.
- Public events page (`/events`), shareable event links and a per-society events link.

**Registration**
- One registration record per student and event; duplicate active registrations blocked; re-registration reuses the record.
- Capacity enforced in a database transaction, so simultaneous registrations cannot overfill an event (tested with five students racing for one seat).

**Volunteers and tasks**
- Invitations for approved events before they start; responses are final; declined students cannot be re-invited.
- Volunteer withdrawal: unfinished tasks are unassigned, In Progress resets to To Do, completed tasks stay with the volunteer.
- Kanban board (To Do, In Progress, Completed) with priority (low to urgent), due dates, overdue and unassigned filters. Only accepted volunteers can be assigned. Progress = completed ÷ total (0% with no tasks).

**Budgets and expenses**
- One combined event-and-budget decision by the administrator; rejection requires remarks.
- Expenses with category, vendor, date and optional receipt (JPG/PNG/WebP/PDF up to 5 MB). Spending may not exceed the approved budget; over-budget events block new expenses.
- Downloadable **PDF expense report** generated from the database.

**Meetings**
- Presidents schedule, edit and cancel society meetings and invite approved members. Students accept or decline. Changes and cancellations notify invitees.

**Administration**
- Dashboard statistics and charts, proposal queue, event monitor, societies list, users and roles.

**Notifications and real time**
- In-app notifications for memberships, submissions and decisions, registrations, invitations, tasks, meetings, cancellations and budget alerts. Read state per notification, All/Unread filter, mark all read.
- Socket.IO pushes notifications and refreshes dashboards; public event pages show live seat counts.

### Changes made at the client's request (differ from the Task 1 brief)
- A president may own **more than one society** (brief: one).
- Administrators can **edit users and change roles** (brief: roles are immutable). Safeguards: an admin cannot remove their own admin role and one admin must always remain.
- Administrators can **approve draft events** and **set a different approved budget** (brief: approve the submitted amount as one decision).

---

## Task 2: Mega Event Management

A Mega Event is an internal parent record for coordinating several activities (for example NEXUS Tech Fest). It is separate from Task 1 events: it never appears in the public listing or landing page, has no public registration, and does not use event approval or volunteer invitations.

**Administrator (Mega Events panel on the admin dashboard)**
- Create a Mega Event with title, description, society, start date, end date and overall budget. The society's president is assigned automatically. A society may have several Mega Events.
- Validation: start date on or before end date; budget ≥ 0. No separate approval.
- Afterwards only the title and description can change. The administrator sees only Mega Events they created and does not manage sub-events.

**Society President (Mega Events panel → Mega Event page)**
- Sub-events with title, description, venue, date, start time and end time. The date must fall inside the Mega Event range; start must be before end on the same day; PKT input, UTC storage.
- One existing Student / Volunteer supervises each sub-event (no new role). Reassigning a supervisor removes the previous supervisor's access immediately.
- Checklist tasks per sub-event, unassigned or assigned to any registered student (no invitation needed).
- One-time budget allocation per sub-event; total allocations cannot exceed the overall budget. Expenses (no admin approval) cannot exceed the sub-event allocation. Allocated, spent and remaining are shown.
- When spending reaches **80%** of a sub-event allocation, the president gets one in-app notification (stored `warned_80` flag; none for a zero allocation).

**Students**
- **My Supervised Sub-events** on the student dashboard, with a completion percentage per sub-event (0% with no tasks) and status controls for that sub-event's tasks.
- Supervisors can view and update tasks of their own sub-events only, and cannot create tasks or see budgets and expenses. Other students update only their own tasks. Sub-event tasks also appear in the normal student task list.

All rules are enforced on the API, not just hidden in the interface.

**Starter data:** `npm run seed` creates the NEXUS society, its president, three students (members of NEXUS), and the demo Mega Event *NEXUS Tech Fest 2026* with two sub-events (Gaming Competition, Web Development Workshop), supervisors, checklist tasks and allocations.

**Not implemented:** the optional AI operations report (Task 2 bonus).

---

## Data model

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | name, email (unique), password_hash, role (`admin`, `president`, `student`) | |
| `otp_codes` | user_id, code_hash, purpose (`login`/`reset`), expires_at, attempts, invalidated | Codes stored as SHA-256 hashes. |
| `societies` | owner_id, name (unique), description, category, contact fields, logo_file, logo_mime | |
| `memberships` | society_id, student_id, status, label (`member`/`core`) | Partial unique index: one pending request per student and society. |
| `events` | society_id, title, venue, start_at, end_at, registration_deadline, capacity, proposed_budget, approved_budget, status, remarks | Times in UTC. |
| `registrations` | event_id, student_id, status (`registered`/`cancelled`) | Unique per event and student. |
| `invitations` | event_id, student_id, status (`invited`/`accepted`/`declined`/`withdrawn`) | Unique per event and student. |
| `tasks` | **event_id or sub_event_id**, title, description, priority, due_at, status, assignee_id | Task 2: `event_id` optional, `sub_event_id` added, one of them required. |
| `expenses` | **event_id or sub_event_id**, description, amount, category, vendor, spent_on, receipt_file/name/mime, created_by | Task 2: same association change as tasks. |
| `meetings`, `meeting_invitations` | society_id, title, starts_at, location, agenda, status; meeting_id, student_id, response | |
| `mega_events` (Task 2) | title, description, society_id, president_id, created_by, start_date, end_date, overall_budget | President set from the society owner at creation. |
| `sub_events` (Task 2) | mega_event_id, title, description, venue, event_date, start_at, end_at, supervisor_id, allocated_budget, warned_80 | `allocated_budget` is set once; `warned_80` is the 80% alert flag. |
| `notifications` | user_id, type, message, link, is_read | Delivered live over Socket.IO. |

### Database changes for Task 2
Migrations run automatically on start-up and keep existing data:
1. New tables `mega_events` and `sub_events`.
2. `tasks` and `expenses` rebuilt so `event_id` is optional and `sub_event_id` is added, with a check that one of them is set. Task 1 summaries filter on `event_id`, so Task 1 and Task 2 figures stay separate.

Schema and migrations: `server/src/db.js`. Business rules: `server/src/lib/domain.js`.

---

## API

Interactive docs (Swagger UI): **http://localhost:4000/api/docs** · OpenAPI JSON: `/api/openapi.json` (77 operations).

Main groups: Auth, Societies, Events, Registrations, Volunteers, Tasks, Expenses, Meetings, Mega Events (`/admin/mega-events`, `/mega-events`, `/sub-events`), Admin, Notifications. Authenticated requests send `Authorization: Bearer <token>`.

---

## Design

The interface follows a "campus bulletin" design system chosen with the ui-ux-pro-max skill: **Minimalism & Swiss Style** (grid, hairline rules, no gradients), the **University Department** palette (institutional navy `#1E3A5F`, ochre accent `#A16207` on warm paper), and **Newsreader** headings with **Public Sans** body text. Theme tokens live in `client/src/theme.css`.

---

## Project structure

```
server/src/
  index.js, app.js        HTTP + Socket.IO server, Express app and routes
  db.js, seed.js          schema, migrations, demo data
  openapi.js              API documentation
  lib/                    auth, domain rules, events, mailer, rate limit, receipts, logos, PDF report, NEXUS seed
  routes/                 auth, societies, events, meetings, megaEvents, admin, notifications
client/src/
  App.jsx                 routes and role guards
  pages/                  Landing, Auth, ResetPassword, PublicEvent(s), Societies, Student, President,
                          ManageEvent, MegaEvent, Admin
  components/             Layout, UI kit, charts, icons, event form
  index.css, dashboard.css, theme.css
```

---

## Testing

There is no automated test suite in the repository. Workflows were verified with scripted API checks and headless-browser runs:
- **Task 1 regression (31 checks, all passing):** validation, PKT/UTC, draft visibility, submit and approval, public listing, registration, duplicates, capacity, seat release, invitations, final responses, tasks and permissions, progress, budget cap, PDF report, edit-returns-to-pending, cancellation.
- **Task 2 (31 checks, all passing):** admin validation and fixed fields, date range, time order, ownership, allocation limits and set-once rule, expense limits, 80% alert sent once, supervisor permissions and reassignment, student task list and supervised progress.
- **Concurrency:** five simultaneous registrations for one seat, one success.
- **Browser:** landing, public event, login, student, president, event management, Mega Event and admin pages load with no page errors and no horizontal overflow.

## Notes and limitations
- `node:sqlite` is marked experimental in Node 22 and prints a warning on start-up.
- The auth rate limit is in memory and resets on restart.
- Session tokens are JWTs in `localStorage` (12 hours); use HTTP-only cookies for production.
- Uploaded receipts and logos are stored in `server/uploads/` (git-ignored).
- Amounts are shown in PKR.
