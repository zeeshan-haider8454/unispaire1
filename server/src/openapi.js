// OpenAPI 3.0 description of the UniSphere API. Served at /api/openapi.json and rendered at /api/docs.
const ERR = { $ref: '#/components/responses/Error' };
const json = (description, schema = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
const body = (properties, required = []) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', properties, required } } },
});
const id = (name = 'id', description = 'Numeric ID') => ({ name, in: 'path', required: true, description, schema: { type: 'integer' } });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const int = (description) => ({ type: 'integer', description });
const PKT = 'Local date and time in Pakistan Standard Time, format YYYY-MM-DDTHH:mm';

// Builds one operation. secured = requires Bearer token.
function op(method, summary, { tag, secured = true, params = [], requestBody, responses } = {}) {
  return {
    method,
    operation: {
      tags: [tag],
      summary,
      ...(secured ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      parameters: params,
      ...(requestBody ? { requestBody } : {}),
      responses: responses ?? { 200: json('OK'), 400: ERR, 401: ERR, 403: ERR, 404: ERR, 409: ERR },
    },
  };
}

const paths = {};
function add(path, ...ops) {
  paths[path] ??= {};
  for (const o of ops) paths[path][o.method] = o.operation;
}

// ---- Health
add('/health', op('get', 'API health and whether email (SMTP) is configured', { tag: 'Health', secured: false, responses: { 200: json('OK', { type: 'object', properties: { ok: { type: 'boolean' }, emailConfigured: { type: 'boolean' } } }) } }));

// ---- Auth
add('/auth/register',
  op('post', 'Create a Student or President account and email a sign-up code', {
    tag: 'Auth', secured: false,
    requestBody: body({ name: str('Full name'), email: str('Email address that receives the code'), password: { type: 'string', minLength: 8 }, role: { type: 'string', enum: ['student', 'president'] } }, ['name', 'email', 'password', 'role']),
    responses: { 201: json('Account created, code sent'), 400: ERR, 409: ERR, 429: ERR, 502: ERR },
  }));
add('/auth/login',
  op('post', 'Step 1 of login: check password and email a six-digit code', {
    tag: 'Auth', secured: false,
    requestBody: body({ email: str('Account email'), password: str('Account password') }, ['email', 'password']),
    responses: { 200: json('Code sent'), 401: ERR, 429: ERR, 502: ERR },
  }));
add('/auth/verify-otp',
  op('post', 'Step 2 of login: check the code and receive a session token', {
    tag: 'Auth', secured: false,
    requestBody: body({ email: str('Account email'), code: { type: 'string', pattern: '^\\d{6}$' } }, ['email', 'code']),
    responses: { 200: json('Session token', { type: 'object', properties: { token: str('JWT, valid 12 hours'), user: { $ref: '#/components/schemas/User' } } }), 400: ERR },
  }));
add('/auth/forgot-password',
  op('post', 'Email a password reset code (same response whether or not the account exists)', {
    tag: 'Auth', secured: false,
    requestBody: body({ email: str('Account email') }, ['email']),
    responses: { 200: json('Generic message'), 429: ERR, 502: ERR },
  }));
add('/auth/reset-password',
  op('post', 'Check the reset code and set a new password', {
    tag: 'Auth', secured: false,
    requestBody: body({ email: str('Account email'), code: { type: 'string', pattern: '^\\d{6}$' }, password: { type: 'string', minLength: 8 } }, ['email', 'code', 'password']),
    responses: { 200: json('Password reset'), 400: ERR },
  }));
add('/auth/me', op('get', 'Current signed-in user', { tag: 'Auth', responses: { 200: json('Current user', { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }), 401: ERR } }));

// ---- Societies
add('/societies/categories', op('get', 'Allowed society categories', { tag: 'Societies', secured: false, responses: { 200: json('Category names', { type: 'array', items: { type: 'string' } }) } }));
add('/societies',
  op('get', 'Browse all societies (login required)', { tag: 'Societies', responses: { 200: json('Societies', { type: 'array', items: { $ref: '#/components/schemas/Society' } }), 401: ERR } }),
  op('post', 'Create the president’s society (one per president)', {
    tag: 'Societies',
    requestBody: body({ name: str('Society name'), description: str('About the society'), category: str('One of the fixed categories'), contact_email: str('Optional'), contact_phone: str('Optional') }, ['name', 'category']),
    responses: { 201: json('Society created', { $ref: '#/components/schemas/Society' }), 400: ERR, 403: ERR, 409: ERR },
  }));
add('/societies/memberships/mine', op('get', 'My membership requests and memberships (student)', { tag: 'Societies', responses: { 200: json('Memberships') } }));
add('/societies/mine', op('get', 'My societies (president), as a list', { tag: 'Societies', responses: { 200: json('Society or null') } }));
add('/societies/{id}',
  op('get', 'Society details with upcoming events and my membership status', { tag: 'Societies', params: [id()] }),
  op('put', 'Update my society (owner only)', {
    tag: 'Societies', params: [id()],
    requestBody: body({ name: str('Society name'), description: str('About'), category: str('Category'), contact_email: str('Email'), contact_phone: str('Phone') }, ['name', 'category']),
  }));
add('/societies/{id}/membership-requests', op('post', 'Request to join a society (student)', { tag: 'Societies', params: [id()], responses: { 201: json('Request pending'), 409: ERR } }));
add('/societies/{id}/memberships', op('get', 'Membership requests and members (owner or admin)', { tag: 'Societies', params: [id()] }));
add('/societies/{id}/memberships/{membershipId}',
  op('patch', 'Approve, reject or remove a membership (owner only)', {
    tag: 'Societies', params: [id(), id('membershipId', 'Membership ID')],
    requestBody: body({ action: { type: 'string', enum: ['approve', 'reject', 'remove'] } }, ['action']),
  }));

// ---- Events
add('/events/public', op('get', 'Approved upcoming and ongoing events (landing page)', {
  tag: 'Events', secured: false,
  params: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 6, maximum: 50 } }],
  responses: { 200: json('Events', { type: 'array', items: { $ref: '#/components/schemas/Event' } }) },
}));
add('/events/mine', op('get', 'All events of my society (president)', { tag: 'Events', responses: { 200: json('Events', { type: 'array', items: { $ref: '#/components/schemas/Event' } }) } }));
add('/events',
  op('post', 'Create an event as a draft (president)', {
    tag: 'Events',
    requestBody: body({
      title: str('Title'), description: str('Description'), venue: str('Venue'),
      start_at: str(PKT), end_at: str(PKT), registration_deadline: str(PKT),
      capacity: int('Participant limit, at least 1'), proposed_budget: num('Proposed budget in PKR, at least 0'),
    }, ['title', 'venue', 'start_at', 'end_at', 'registration_deadline', 'capacity', 'proposed_budget']),
    responses: { 201: json('Draft created', { $ref: '#/components/schemas/Event' }), 400: ERR, 403: ERR },
  }));
add('/events/{id}',
  op('get', 'Event details. Approved events are public; other states are visible only to their president and admins', { tag: 'Events', secured: false, params: [id()] }),
  op('put', 'Edit an event before it starts (president). Editing an approved event returns it to Pending', {
    tag: 'Events', params: [id()],
    requestBody: body({
      title: str('Title'), description: str('Description'), venue: str('Venue'),
      start_at: str(PKT), end_at: str(PKT), registration_deadline: str(PKT),
      capacity: int('Capacity'), proposed_budget: num('Proposed budget'),
    }, ['title', 'venue', 'start_at', 'end_at', 'registration_deadline', 'capacity', 'proposed_budget']),
  }));
add('/events/{id}/submit', op('post', 'Submit a draft or rejected event for approval (president)', { tag: 'Events', params: [id()] }));
add('/events/{id}/cancel', op('post', 'Cancel an event (president). Irreversible', { tag: 'Events', params: [id()] }));
add('/events/{id}/register',
  op('post', 'Register for an approved event (student)', { tag: 'Registrations', params: [id()], responses: { 200: json('Registered'), 409: ERR } }),
  op('delete', 'Cancel my registration before the event starts (student)', { tag: 'Registrations', params: [id()] }));
add('/registrations/mine', op('get', 'My registrations (student)', { tag: 'Registrations' }));
add('/events/{id}/registrations', op('get', 'Registrations for an event (president or admin)', { tag: 'Registrations', params: [id()] }));

// ---- Volunteers
add('/events/{id}/invite-candidates', op('get', 'Students to invite, society members first (president)', { tag: 'Volunteers', params: [id()] }));
add('/events/{id}/invitations',
  op('get', 'Volunteer invitations for an event (president or admin)', { tag: 'Volunteers', params: [id()] }),
  op('post', 'Invite a student to volunteer (president, approved events before start)', {
    tag: 'Volunteers', params: [id()],
    requestBody: body({ student_id: int('Student user ID') }, ['student_id']),
    responses: { 201: json('Invited'), 409: ERR },
  }));
add('/invitations/mine', op('get', 'My volunteer invitations (student)', { tag: 'Volunteers' }));
add('/invitations/{id}/respond',
  op('post', 'Accept or decline an invitation (student). Responses are final', {
    tag: 'Volunteers', params: [id('id', 'Invitation ID')],
    requestBody: body({ accept: { type: 'boolean' } }, ['accept']),
  }));

// ---- Tasks
add('/events/{id}/tasks',
  op('get', 'Task board and progress (president, admin, or accepted volunteer)', { tag: 'Tasks', params: [id()] }),
  op('post', 'Create a task (president)', {
    tag: 'Tasks', params: [id()],
    requestBody: body({ title: str('Title'), description: str('Description'), priority: { type: 'string', enum: ['low', 'medium', 'high'] }, due_at: str(PKT) }, ['title', 'due_at']),
    responses: { 201: json('Created'), 400: ERR, 409: ERR },
  }));
add('/tasks/{id}',
  op('patch', 'Update a task. President can edit any field and assign accepted volunteers; assignee can change status only', {
    tag: 'Tasks', params: [id('id', 'Task ID')],
    requestBody: body({
      title: str('Title'), description: str('Description'), priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      due_at: str(PKT), assignee_id: { type: 'integer', nullable: true, description: 'Accepted volunteer user ID, or null to unassign' },
      status: { type: 'string', enum: ['todo', 'in_progress', 'completed'] },
    }),
  }));
add('/tasks/mine', op('get', 'Tasks assigned to me (student)', { tag: 'Tasks' }));

// ---- Expenses
add('/events/{id}/expenses',
  op('get', 'Expenses and budget summary (president or admin)', { tag: 'Expenses', params: [id()] }),
  op('post', 'Record an expense within the approved budget (president)', {
    tag: 'Expenses', params: [id()],
    requestBody: body({ description: str('What was bought'), amount: num('Amount in PKR, greater than 0'), spent_on: str('YYYY-MM-DD') }, ['description', 'amount']),
    responses: { 201: json('Recorded'), 400: ERR, 409: ERR },
  }));
add('/expenses/{id}',
  op('put', 'Edit an expense (president). Increases must fit the approved budget', {
    tag: 'Expenses', params: [id('id', 'Expense ID')],
    requestBody: body({ description: str('Description'), amount: num('Amount'), spent_on: str('YYYY-MM-DD') }, ['description', 'amount']),
  }),
  op('delete', 'Delete an expense (president)', { tag: 'Expenses', params: [id('id', 'Expense ID')] }));

// ---- Admin
add('/admin/dashboard', op('get', 'Counts and proposals awaiting a decision (admin)', { tag: 'Admin' }));
add('/admin/events', op('get', 'All events with budgets and progress (admin)', {
  tag: 'Admin',
  params: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'pending', 'approved', 'rejected', 'cancelled'] } }],
}));
add('/admin/events/{id}/decision',
  op('post', 'Approve or reject a draft or pending event (admin). Approve may set a different budget', {
    tag: 'Admin', params: [id()],
    requestBody: body({
      decision: { type: 'string', enum: ['approve', 'reject'] },
      remarks: str('Required when rejecting'),
      approved_budget: num('Optional when approving. Defaults to the proposed budget'),
    }, ['decision']),
  }));
add('/admin/users', op('get', 'All accounts with roles (admin)', { tag: 'Admin' }));
add('/admin/users/{id}',
  op('patch', 'Edit a user’s name, email or role (admin)', {
    tag: 'Admin', params: [id('id', 'User ID')],
    requestBody: body({ name: str('Name'), email: str('Email'), role: { type: 'string', enum: ['admin', 'president', 'student'] } }),
  }));
add('/admin/societies', op('get', 'All societies with member and event counts (admin)', { tag: 'Admin' }));

// ---- Notifications
add('/notifications', op('get', 'My latest notifications and unread count', { tag: 'Notifications' }));
add('/notifications/read-all', op('post', 'Mark all my notifications as read', { tag: 'Notifications' }));

add('/notifications/{id}/read', op('post', 'Mark one of my notifications as read', { tag: 'Notifications', params: [id('id', 'Notification ID')] }));

// ---- Additions: bonus features
add('/invitations/{id}/withdraw', op('post', 'Accepted volunteer withdraws. Unfinished tasks are unassigned; In Progress resets to To Do', { tag: 'Volunteers', params: [id('id', 'Invitation ID')] }));
add('/tasks/{id}',
  op('patch', 'Update a task. President edits any field; assignee (and, for sub-event tasks, the supervisor) changes status only', {
    tag: 'Tasks', params: [id('id', 'Task ID')],
    requestBody: body({
      title: str('Title'), description: str('Description'), priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      due_at: str(PKT), assignee_id: { type: 'integer', nullable: true }, status: { type: 'string', enum: ['todo', 'in_progress', 'completed'] },
    }),
  }),
  op('delete', 'Delete a task (president who owns the event or Mega Event)', { tag: 'Tasks', params: [id('id', 'Task ID')] }));
add('/events/{id}/expense-report.pdf', op('get', 'Download the event expense report as PDF (president or admin)', {
  tag: 'Expenses', params: [id()],
  responses: { 200: { description: 'PDF file', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 403: ERR, 404: ERR },
}));
add('/expenses/{id}/receipt', op('get', 'Open an expense receipt (president or admin)', {
  tag: 'Expenses', params: [id('id', 'Expense ID')],
  responses: { 200: { description: 'Image or PDF file' }, 403: ERR, 404: ERR },
}));
add('/societies/{id}/logo',
  op('get', 'Society logo image (login required)', { tag: 'Societies', params: [id()], responses: { 200: { description: 'Image file' }, 404: ERR } }),
  op('post', 'Upload or replace the society logo (owner; JPG, PNG or WebP up to 2 MB, multipart field "logo")', {
    tag: 'Societies', params: [id()],
    requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { logo: { type: 'string', format: 'binary' } } } } } },
  }));

// ---- Meetings
add('/societies/{id}/meetings',
  op('get', 'Meetings of a society (owner or admin)', { tag: 'Meetings', params: [id()] }),
  op('post', 'Schedule a meeting and invite approved members (owner)', {
    tag: 'Meetings', params: [id()],
    requestBody: body({ title: str('Title'), starts_at: str(PKT), location: str('Location'), agenda: str('Agenda'), description: str('Description'), student_ids: { type: 'array', items: { type: 'integer' } } }, ['title', 'starts_at']),
    responses: { 201: json('Created'), 400: ERR, 403: ERR },
  }));
add('/meetings/{id}', op('patch', 'Edit a scheduled meeting; invitees are notified of changes (owner)', {
  tag: 'Meetings', params: [id()],
  requestBody: body({ title: str('Title'), starts_at: str(PKT), location: str('Location'), agenda: str('Agenda'), description: str('Description') }),
}));
add('/meetings/{id}/cancel', op('post', 'Cancel a meeting; invitees are notified (owner)', { tag: 'Meetings', params: [id()] }));
add('/meetings/{id}/invitees', op('post', 'Invite more approved members (owner)', {
  tag: 'Meetings', params: [id()], requestBody: body({ student_ids: { type: 'array', items: { type: 'integer' } } }, ['student_ids']),
}));
add('/meetings/mine', op('get', 'Meetings I am invited to (student)', { tag: 'Meetings' }));
add('/meetings/invitations/{id}/respond', op('post', 'Accept or decline a meeting invitation (student)', {
  tag: 'Meetings', params: [id('id', 'Meeting invitation ID')], requestBody: body({ accept: { type: 'boolean' } }, ['accept']),
}));

// ---- Task 2: Mega Events
add('/admin/mega-events',
  op('get', 'Mega Events created by me, with budget and task summaries (admin)', { tag: 'Mega Events' }),
  op('post', 'Create a Mega Event for a society; its president is assigned automatically (admin)', {
    tag: 'Mega Events',
    requestBody: body({
      title: str('Title'), description: str('Description'), society_id: int('Society ID'),
      start_date: str('YYYY-MM-DD (PKT)'), end_date: str('YYYY-MM-DD (PKT), on or after start'), overall_budget: num('Overall budget in PKR, at least 0'),
    }, ['title', 'society_id', 'start_date', 'end_date', 'overall_budget']),
    responses: { 201: json('Created'), 400: ERR, 403: ERR },
  }));
add('/admin/mega-events/societies', op('get', 'Societies and their presidents for the create form (admin)', { tag: 'Mega Events' }));
add('/admin/mega-events/{id}', op('patch', 'Change title or description only; society, president, dates and budget are fixed (admin who created it)', {
  tag: 'Mega Events', params: [id()], requestBody: body({ title: str('Title'), description: str('Description') }),
}));
add('/mega-events/mine', op('get', 'Mega Events assigned to me (president)', { tag: 'Mega Events' }));
add('/mega-events/{id}', op('get', 'Mega Event with summary and sub-events (assigned president)', { tag: 'Mega Events', params: [id()] }));
add('/mega-events/{id}/sub-events', op('post', 'Create a sub-event: date within the Mega Event range, start before end, optional supervisor and allocation (president)', {
  tag: 'Mega Events', params: [id()],
  requestBody: body({
    title: str('Title'), description: str('Description'), venue: str('Venue'),
    event_date: str('YYYY-MM-DD (PKT)'), start_time: str('HH:mm (PKT)'), end_time: str('HH:mm (PKT)'),
    supervisor_id: { type: 'integer', nullable: true, description: 'Existing Student / Volunteer' },
    allocated_budget: { type: 'number', nullable: true, description: 'Set once; all allocations must fit the overall budget' },
  }, ['title', 'description', 'venue', 'event_date', 'start_time', 'end_time']),
  responses: { 201: json('Created'), 400: ERR, 403: ERR },
}));
add('/sub-events/supervised', op('get', 'Sub-events I supervise, with completion percentage and checklist (student)', { tag: 'Mega Events' }));
add('/sub-events/{id}',
  op('get', 'Sub-event detail. President sees budget and expenses; the supervisor sees tasks only', { tag: 'Mega Events', params: [id()] }),
  op('patch', 'Edit sub-event details or change its supervisor (president). The previous supervisor loses access immediately', {
    tag: 'Mega Events', params: [id()],
    requestBody: body({
      title: str('Title'), description: str('Description'), venue: str('Venue'),
      event_date: str('YYYY-MM-DD (PKT)'), start_time: str('HH:mm (PKT)'), end_time: str('HH:mm (PKT)'),
      supervisor_id: { type: 'integer', nullable: true },
    }),
  }));
add('/sub-events/{id}/allocation', op('post', 'Set the sub-event budget allocation once (president)', {
  tag: 'Mega Events', params: [id()], requestBody: body({ amount: num('PKR, at least 0') }, ['amount']),
  responses: { 200: json('Allocation set'), 400: ERR, 403: ERR, 409: ERR },
}));
add('/sub-events/{id}/expenses', op('post', 'Record a sub-event expense within its allocation; notifies the president once at 80% (president)', {
  tag: 'Mega Events', params: [id()],
  requestBody: body({ description: str('Description'), amount: num('PKR, greater than 0'), category: str('Category'), vendor: str('Vendor'), spent_on: str('YYYY-MM-DD') }, ['description', 'amount']),
  responses: { 201: json('Recorded'), 400: ERR, 403: ERR, 409: ERR },
}));
add('/sub-events/{id}/tasks', op('post', 'Create a checklist task; may be assigned to any registered student (president)', {
  tag: 'Mega Events', params: [id()],
  requestBody: body({ title: str('Title'), description: str('Description'), priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, due_at: str(PKT), assignee_id: { type: 'integer', nullable: true } }, ['title']),
  responses: { 201: json('Created'), 400: ERR, 403: ERR },
}));
add('/students/directory', op('get', 'Registered students for supervisor and assignee pickers (president)', { tag: 'Mega Events' }));

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'UniSphere API',
    version: '1.0.0',
    description: 'University society and event management. Log in with email, password and the six-digit code. Use the returned token as `Authorization: Bearer <token>`.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Health' }, { name: 'Auth' }, { name: 'Societies' }, { name: 'Events' }, { name: 'Registrations' },
    { name: 'Volunteers' }, { name: 'Tasks' }, { name: 'Expenses' }, { name: 'Meetings' }, { name: 'Mega Events' },
    { name: 'Admin' }, { name: 'Notifications' },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    responses: {
      Error: json('Error', { type: 'object', properties: { error: str('Message') } }),
    },
    schemas: {
      User: {
        type: 'object',
        properties: { id: int('User ID'), name: str('Name'), email: str('Email'), role: { type: 'string', enum: ['admin', 'president', 'student'] } },
      },
      Society: {
        type: 'object',
        properties: { id: int('Society ID'), name: str('Name'), description: str('About'), category: str('Category'), president_name: str('President') },
      },
      Event: {
        type: 'object',
        properties: {
          id: int('Event ID'), title: str('Title'), venue: str('Venue'), society_name: str('Society'),
          start_at: str('Start (UTC ISO)'), end_at: str('End (UTC ISO)'), registration_deadline: str('Deadline (UTC ISO)'),
          capacity: int('Capacity'), status: { type: 'string', enum: ['draft', 'pending', 'approved', 'rejected', 'cancelled'] },
          schedule_status: { type: 'string', enum: ['upcoming', 'ongoing', 'completed'] },
          seats_remaining: int('Seats left'), actions: { type: 'object', description: 'Which actions are allowed in the current state' },
        },
      },
    },
  },
};

export const swaggerPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>UniSphere API docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', persistAuthorization: true });
    </script>
  </body>
</html>`;
