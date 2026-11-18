import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { homePathFor } from '../roles.js';
import { useApi } from '../hooks.js';
import { Alert, EventCard, Empty, Loading } from '../components/ui.jsx';

function Audience({ title, children }) {
  return (
    <div className="card audience-card">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const { data, error, loading } = useApi('/events/public?limit=6');

  return (
    <>
      <section className="hero">
        <p className="eyebrow">University Society &amp; Event Management</p>
        <h1>Organize, join and oversee campus life in one place.</h1>
        <p className="lead">
          UniSphere helps students discover societies and events, helps organizers coordinate members,
          volunteers, tasks and budgets, and helps university administration oversee approvals and activity.
        </p>
        <div className="cta">
          {user ? (
            <Link className="btn btn-primary" to={homePathFor(user.role)}>Go to my dashboard</Link>
          ) : (
            <>
              <Link className="btn btn-primary" to="/register">Get started</Link>
              <Link className="btn" to="/login">Log in</Link>
            </>
          )}
        </div>
      </section>

      <section className="audience">
        <Audience title="Students">
          Discover societies and approved events, request to join, register for events and complete volunteer tasks.
        </Audience>
        <Audience title="Organizers">
          Manage your society's members, events, volunteers, task board and expenses against an approved budget.
        </Audience>
        <Audience title="University administration">
          Review event proposals and budgets, and monitor registrations, task progress and spending across societies.
        </Audience>
      </section>

      <section>
        <h2>Upcoming events</h2>
        {loading && <Loading />}
        <Alert>{error}</Alert>
        {data && data.length === 0 && <Empty>No upcoming approved events yet.</Empty>}
        <div className="grid">
          {data?.map((ev) => <EventCard key={ev.id} ev={ev} />)}
        </div>
      </section>
    </>
  );
}
