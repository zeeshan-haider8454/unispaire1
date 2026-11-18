import { useState } from 'react';
import { toPktInput } from '../format.js';

const EMPTY = {
  title: '',
  description: '',
  venue: '',
  start_at: '',
  end_at: '',
  registration_deadline: '',
  capacity: 50,
  proposed_budget: 0,
};

// Turns a saved event into form values (dates converted to PKT for the inputs).
export function eventFormFrom(ev) {
  if (!ev) return EMPTY;
  return {
    title: ev.title,
    description: ev.description,
    venue: ev.venue,
    start_at: toPktInput(ev.start_at),
    end_at: toPktInput(ev.end_at),
    registration_deadline: toPktInput(ev.registration_deadline),
    capacity: ev.capacity,
    proposed_budget: ev.proposed_budget,
  };
}

export default function EventForm({ initial, onSubmit, submitLabel = 'Save', busy = false, onCancel }) {
  const [values, setValues] = useState(() => eventFormFrom(initial));
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <label className="span-2">
        Title
        <input required value={values.title} onChange={set('title')} />
      </label>
      <label className="span-2">
        Description
        <textarea rows={3} value={values.description} onChange={set('description')} />
      </label>
      <label>
        Venue
        <input required value={values.venue} onChange={set('venue')} />
      </label>
      <label>
        Capacity (participants)
        <input type="number" min="1" required value={values.capacity} onChange={set('capacity')} />
      </label>
      <label>
        Start (PKT)
        <input type="datetime-local" required value={values.start_at} onChange={set('start_at')} />
      </label>
      <label>
        End (PKT)
        <input type="datetime-local" required value={values.end_at} onChange={set('end_at')} />
      </label>
      <label>
        Registration deadline (PKT)
        <input type="datetime-local" required value={values.registration_deadline} onChange={set('registration_deadline')} />
      </label>
      <label>
        Proposed budget (PKR)
        <input type="number" min="0" step="0.01" required value={values.proposed_budget} onChange={set('proposed_budget')} />
      </label>
      <div className="span-2 form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>{submitLabel}</button>
        {onCancel && (
          <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}
