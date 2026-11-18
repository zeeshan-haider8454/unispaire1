# UniSphere

A university society and event management platform. Society presidents run their society, its events, volunteers, tasks and expenses. Students discover societies and events, request membership, register and volunteer. University administrators approve event proposals and budgets and monitor activity.

**Stack:** React (Vite) · Node.js · Express 5 · SQLite (built-in `node:sqlite`) · Socket.IO · JWT · bcrypt

---

## Setup

**Requirements:** Node.js **22.13 or newer** (uses the built-in `node:sqlite` module). Check with `node -v`.

### 1. Start the API

```bash
cd server
npm install
npm run seed     # creates the database and demo data, including the administrator account
npm run dev      # API on http://localhost:4000
```

### 2. Start the React client

In a second terminal:

```bash
cd client
npm install
npm run dev      # app on http://localhost:5173
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` and `/socket.io` to the API.

### Single-origin run (optional)

```bash
cd client && npm run build      # builds client/dist
cd ../server && npm start       # serves the app and API on http://localhost:4000
```

### Environment variables (all optional)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | API port | `4000` |
| `JWT_SECRET` | Signs session tokens. **Set this for any shared deployment.** | development fallback |
| `DB_PATH` | SQLite file location | `server/data/unisphere.db` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Administrator created by `npm run seed` | `admin@unisphere.edu` / `Admin@12345` |
| `DEMO_PASSWORD` | Password for the demo president and students | `Demo@12345` |

---

## Test accounts

Created by `npm run seed`. These are for local demonstration only; change them before any real use.

| Role | Email | Password |
| --- | --- | --- |
| University Administrator | `admin@unisphere.edu` | `Admin@12345` |
| Society President / Organizer | `president@unisphere.edu` | `Demo@12345` |
| Student / Volunteer | `ali@unisphere.edu` | `Demo@12345` |
| Student / Volunteer | `sara@unisphere.edu` | `Demo@12345` |
| Student / Volunteer | `bilal@unisphere.edu` | `Demo@12345` |

The administrator account is created by the seed script only. Public signup offers only the Student and President roles.

### Email OTP for local testing

Every login attempt and every registration issues a new six-digit code that expires after 10 minutes. No email service is configured, so the code is **printed to the API server console**:

```
[UniSphere OTP] ali@unisphere.edu -> 482913   (valid for 10 minutes)
```

Enter that code on the verification step. The code is never shown in the web interface and is never a fixed value. A wrong code counts toward five attempts, after which a new code is needed. Resending has a 60-second cooldown, and a new code invalidates the previous one.

Demo walkthrough (about 5 minutes):

1. **Admin:** log in as the administrator, open **Administration**, and approve "Web Development Bootcamp" (a pending proposal).
2. **Student:** log in as `ali@unisphere.edu`. The dashboard shows an accepted volunteer role and an assigned task. Open **AI Workshop** from the landing page and see seats remaining.
3. **Registration:** log in as `bilal@unisphere.edu` and register for AI Workshop. Log out, then log in as the president. The president receives a live notification and the seat count updates on any open event page.
4. **President:** open **Tech Circle → Campus Hackathon 2026**. The task board, budget summary and expense recording are there. Recorded spending is capped at the approved budget.
5. **New event:** create an event as the president, submit it, and approve it as the administrator.

---

## Implemented features

**Authentication and roles**
- Signup for Student and President, with email and password, then a six-digit email OTP as the second step.
- OTP rules: 10-minute expiry, five attempts, 60-second resend cooldown, and a new code invalidates the old one.
- Forgot password: request a six-digit reset code by email (**Forgot password?** on the login page), then enter the code and a new password. The reset code expires in 10 minutes, allows five attempts, and is single-use. The response is the same whether or not the email has an account.
- Role guards on every API route and every page. The administrator role cannot be chosen at signup.
- Logged-out visitors who press **Register** on an event page keep their destination through signup, login and OTP, then return to the event.

**Societies and membership**
- A president creates one society (active immediately) with name, description, category from a fixed list, and contact details.
- Students request to join. Only one pending request per student and society is allowed. Presidents approve, reject or remove members. Rejected or removed students can request again.
- Each president can manage only their own society and its events.

**Events**
- Create, edit and submit events. Validation covers start before end, registration deadline on or before start, capacity of at least 1, and budget of at least 0.
- Times are entered in **Pakistan Standard Time (Asia/Karachi)** regardless of the browser's timezone. They are stored in UTC and displayed in PKT.
- Approval status (Draft, Pending, Approved, Rejected, Cancelled) is separate from schedule status (Upcoming, Ongoing, Completed). Schedule status is computed from the current time.
- Permitted actions follow the Event Status Table. Editing an approved event sends it back for re-approval. Cancellation is irreversible, closes registration, and keeps the registration records as Cancelled.

**Public event pages and registration**
- Approved upcoming and ongoing events are public. Completed events stay viewable by direct link with registration closed.
- Capacity is enforced inside a database transaction, so simultaneous registrations cannot overfill an event. One registration record per student and event. Cancelling releases the seat, and re-registering reuses the record.
- Capacity cannot be reduced below the number of active registrations.

**Volunteers and tasks**
- Presidents invite students to approved events before they start. Declined invitations cannot be re-sent. Responses are final.
- Kanban task board (To Do, In Progress, Completed) with priority and due date. Tasks can be unassigned. Only students who accepted an invitation can be assigned.
- Assignees can update their own task status. Event progress is completed tasks divided by total tasks, or 0% if there are none.

**Budget and expenses**
- The administrator approves or rejects the event and its proposed budget together. Rejection requires remarks. The administrator cannot change the requested amount.
- Presidents record, edit and delete expenses. Each expense can have a receipt: a JPG, PNG, WebP or PDF up to 5 MB. Receipts are stored in `server/uploads/receipts` and can be viewed only by the event's president and administrators, through an authenticated request. Total spending cannot exceed the approved budget. When a re-approval sets the budget below recorded spending, the administrator sees a warning, the balance shows **Over budget**, and new expenses are blocked.
- The approved budget, total spent and remaining balance are calculated automatically.

**Administration**
- Dashboard with counts of societies, events, active registrations, pending proposals and approved events.
- Pending proposal queue with budget details and approve or reject actions.
- Event monitor with registrations, task progress and budget summaries, filterable by approval status. Societies list.

**Notifications and real-time updates**
- In-app notifications for membership requests and decisions, event submissions and decisions, new registrations, volunteer invitations and responses, task assignments and status changes, and event cancellations (to registered students and invited or accepted volunteers).
- Socket.IO pushes notifications to the bell without a refresh. Dashboards refetch when relevant data changes. Event pages show seat counts and status live.

**Landing page**
- Introduces UniSphere and its three audiences. Lists the next upcoming approved events automatically (up to six).

**Not implemented (bonus items):** PDF expense report, society logo upload, Member / Core Member labels, volunteer withdrawal and task reset, meeting management. Cancellation notifications and budget re-approval handling are implemented (see above).

---

## Data model

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | id, name, email (unique), password_hash, role (`admin`, `president`, `student`) | Administrators can change a user's role from the admin dashboard. Safeguards: an admin cannot remove their own admin role, and at least one administrator must remain. A president who owns a society cannot be demoted until the society is handed over. |
| `otp_codes` | user_id, code_hash, expires_at, attempts, invalidated | Codes are stored as SHA-256 hashes. |
| `societies` | owner_id (unique), name (unique), description, category, contact fields | One society per president. |
| `memberships` | society_id, student_id, status (`pending`, `approved`, `rejected`, `removed`) | Partial unique index allows one pending request per student and society. |
| `events` | society_id, title, venue, start_at, end_at, registration_deadline, capacity, proposed_budget, approved_budget, status, remarks | Times are UTC ISO strings. `approved_budget` holds the last approved amount. |
| `registrations` | event_id, student_id, status (`registered`, `cancelled`) | Unique per event and student. |
| `invitations` | event_id, student_id, status (`invited`, `accepted`, `declined`) | Unique per event and student. |
| `tasks` | event_id, title, priority, due_at, status (`todo`, `in_progress`, `completed`), assignee_id | Assignee is nullable. |
| `expenses` | event_id, description, amount, spent_on, created_by | Amount must be greater than 0. |
| `notifications` | user_id, type, message, link, is_read | Delivered live over Socket.IO. |

Schema and constraints are in `server/src/db.js`. Business rules are in `server/src/lib/domain.js`.

---

## API overview

All endpoints are under `/api`. Authenticated requests send `Authorization: Bearer <token>`.

- **Auth:** `POST /auth/register`, `POST /auth/login` (sends OTP), `POST /auth/verify-otp`, `GET /auth/me`
- **Societies:** `GET /societies`, `GET /societies/categories`, `GET|POST /societies/mine`, `GET|PUT /societies/:id`, membership requests and decisions under `/societies/:id/membership-requests` and `/societies/:id/memberships`
- **Events:** `GET /events/public`, `GET /events/mine`, `POST /events`, `GET|PUT /events/:id`, `POST /events/:id/submit`, `POST /events/:id/cancel`, `POST|DELETE /events/:id/register`
- **Volunteers and tasks:** `GET|POST /events/:id/invitations`, `POST /invitations/:id/respond`, `GET|POST /events/:id/tasks`, `PATCH /tasks/:id`
- **Expenses:** `GET|POST /events/:id/expenses`, `PUT|DELETE /expenses/:id`
- **Admin:** `GET /admin/dashboard`, `GET /admin/events`, `POST /admin/events/:id/decision`, `GET /admin/societies`
- **Notifications:** `GET /notifications`, `POST /notifications/read-all`

Socket.IO events: `notification`, `data:changed` (refetch signal with no private data), `event:updated` (for pages that joined the event room).

---

## Project structure

```
server/
  src/
    index.js        HTTP and Socket.IO server
    app.js          Express app and routes
    db.js           SQLite schema and transactions
    seed.js         Demo data and administrator account
    lib/            auth, domain rules, event serialization, realtime helpers
    routes/         auth, societies, events (incl. tasks, expenses), admin, notifications
client/
  src/
    App.jsx         Routes and role guards
    pages/          Landing, Auth, PublicEvent, Societies, Student, President, ManageEvent, Admin
    components/     Layout (nav and notification bell), shared UI, EventForm
    hooks.js        Data fetching and live-update hooks
    format.js       PKT date handling and formatting
```

---

## Notes and limitations

- OTP emails are sent through Gmail SMTP (`server/src/lib/mailer.js`). Setup:
  1. Turn on 2-Step Verification for the Gmail account, then create an App Password at https://myaccount.google.com/apppasswords.
  2. Copy `server/.env.example` to `server/.env` and set `SMTP_PASS` to the App Password. Do not commit `.env`.
  3. Restart `npm run dev`. Codes now arrive by email.
  
  If `SMTP_PASS` is empty, codes are printed to the API console instead. If sending fails, the login step returns an error and no code is stored.
- Session tokens are JWTs kept in `localStorage`, valid for 12 hours. Acceptable for an MVP, but use HTTP-only cookies for a production deployment.
- `node:sqlite` is marked experimental in Node 22 and prints a warning on start-up. This is expected.
- Amounts are shown in PKR. The brief does not name a currency, so this is an assumption.
- No automated test suite is included. The main flows were checked with scripted API calls and a headless-browser run through the UI.
