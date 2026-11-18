import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { Alert, EmptyState, EventCard, Loading } from '../components/ui.jsx';

// Public list of approved upcoming and ongoing events. Anyone can open it without logging in.
// With ?society=ID it shows only that society's events, which is the link presidents share.
export default function PublicEvents() {
  const { data, error, loading } = useApi('/events/public?limit=50');
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const societyId = params.get('society');
  const society = societyId ? (data ?? []).find((ev) => String(ev.society_id) === societyId) : null;

  const visible = useMemo(() => {
    let list = data ?? [];
    if (societyId) list = list.filter((ev) => String(ev.society_id) === societyId);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((ev) =>
      [ev.title, ev.society_name, ev.venue].some((field) => String(field ?? '').toLowerCase().includes(q)),
    );
  }, [data, query, societyId]);

  const heading = societyId ? (society?.society_name ?? 'Society events') : 'Upcoming events';

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{societyId ? 'Society events' : 'Public'}</p>
          <h1>{heading}</h1>
          <p className="muted">
            {societyId
              ? 'Upcoming approved events from this society. Open an event to see details and register.'
              : 'Approved events from every society. Share any event page with its public link.'}
          </p>
          {societyId && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setParams({})}>
              Show all events
            </button>
          )}
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="Search by title, society or venue"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search events"
        />
      </div>

      {loading && !data && <Loading />}
      <Alert>{error}</Alert>
      {data && visible.length === 0 && (
        <EmptyState icon="calendar" title={query ? 'No matching events' : 'No upcoming events yet'}>
          {query ? 'Try a different search.' : 'Approved events will appear here.'}
        </EmptyState>
      )}
      <div className="grid">
        {visible.map((ev) => <EventCard key={ev.id} ev={ev} />)}
      </div>
      {data && societyId && visible.length > 0 && (
        <p className="muted small"><Link to="/events">See events from all societies</Link></p>
      )}
    </>
  );
}
