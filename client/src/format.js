// All event times are shown in Pakistan Standard Time, whatever the browser's timezone.
export const PKT = 'Asia/Karachi';

const displayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PKT,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatPKT(iso) {
  if (!iso) return '—';
  return `${displayFormat.format(new Date(iso))} PKT`;
}

// Converts a stored UTC timestamp to the 'YYYY-MM-DDTHH:mm' value a datetime-local input expects, in PKT.
export function toPktInput(iso) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PKT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Current time in PKT as a datetime-local value, used as a default for new forms.
export function nowPktInput() {
  return toPktInput(new Date().toISOString());
}

export const money = (value) =>
  value === null || value === undefined ? '—' : `PKR ${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

export const labelize = (value) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const SCHEDULE_LABELS = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' };
export const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const TASK_STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', completed: 'Completed' };
