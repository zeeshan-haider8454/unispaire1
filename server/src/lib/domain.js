// Business rules shared by routes. Event state rules follow the Event Status Table in the brief.

export const CATEGORIES = [
  'Technology',
  'Arts & Culture',
  'Sports & Recreation',
  'Academic',
  'Social Service',
  'Business & Entrepreneurship',
  'Media & Design',
  'Other',
];

// Asia/Karachi (PKT) has no daylight saving time, so a fixed offset is exact.
const PKT_OFFSET = '+05:00';

export const nowIso = () => new Date().toISOString();

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function progressPercent(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

// Converts 'YYYY-MM-DDTHH:mm' (entered as Pakistan time) to a UTC ISO string.
export function pktToIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const ms = Date.parse(`${withSeconds}${PKT_OFFSET}`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// Computes schedule status and the actions allowed for an event in its current state.
export function eventFlags(ev, { now = Date.now(), registered = 0, spent = 0 } = {}) {
  const start = Date.parse(ev.start_at);
  const end = Date.parse(ev.end_at);
  const deadline = Date.parse(ev.registration_deadline);
  const schedule_status = now < start ? 'upcoming' : now < end ? 'ongoing' : 'completed';

  const approved = ev.status === 'approved';
  const cancelled = ev.status === 'cancelled';
  const notStarted = now < start;
  const hasBudget = ev.approved_budget != null;
  const budget_remaining = hasBudget ? round2(ev.approved_budget - spent) : null;

  return {
    schedule_status,
    budget_remaining,
    actions: {
      edit: notStarted && ['draft', 'rejected', 'approved'].includes(ev.status),
      submit: notStarted && ['draft', 'rejected'].includes(ev.status),
      cancel: !cancelled && !(approved && schedule_status === 'completed'),
      register: approved && schedule_status === 'upcoming' && now < deadline && registered < ev.capacity,
      invite: approved && notStarted,
      add_tasks: !cancelled,
      add_expenses: approved && hasBudget && spent < ev.approved_budget,
    },
  };
}
