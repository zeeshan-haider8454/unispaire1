import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { homePathFor } from '../roles.js';
import { useApi } from '../hooks.js';
import { Alert, EventCard, Empty, Loading } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

const PKT = 'Asia/Karachi';
const todayLine = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: PKT, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
const dayOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: PKT, day: '2-digit' }).format(new Date(iso));
const monthOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: PKT, month: 'short' }).format(new Date(iso));
const timeOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: PKT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function Audience({ title, children, icon }) {
  return (
    <div className="audience-card">
      <span className="audience-icon"><Icon name={icon} size={20} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const { data, error, loading } = useApi('/events/public?limit=6');
  const nextUp = (data ?? []).slice(0, 3);

  return (
    <>
      <div className="dateline">
        <span>The UniSphere campus bulletin</span>
        <span>{todayLine()}</span>
      </div>

      <section className="hero landing-grid">
        <div>
          <p className="eyebrow">University society &amp; event management</p>
          <h1>Campus life, organised by the people who run it.</h1>
          <p className="lead">
            Find a society, sign up for what&rsquo;s on this week, and help run the events you care about.
            Organisers plan members, volunteers, tasks and budgets in one place, and the university
            signs off proposals without the spreadsheets.
          </p>
          <div className="cta">
            {user ? (
              <Link className="btn btn-primary" to={homePathFor(user.role)}>Go to my dashboard <Icon name="arrow" size={16} /></Link>
            ) : (
              <>
                <Link className="btn btn-primary" to="/register">Create an account</Link>
                <Link className="btn" to="/events">Browse events</Link>
              </>
            )}
          </div>
        </div>

        <aside className="next-up" aria-label="Next events">
          <h2>Next on campus</h2>
          {loading && <Loading />}
          {data && nextUp.length === 0 && <p className="muted small">No approved events are scheduled yet.</p>}
          <ol>
            {nextUp.map((ev) => (
              <li key={ev.id}>
                <div className="day">
                  {dayOf(ev.start_at)}
                  <span className="mon">{monthOf(ev.start_at)}</span>
                </div>
                <div>
                  <Link to={`/events/${ev.id}`}>{ev.title}</Link>
                  <div className="where">{ev.society_name} · {timeOf(ev.start_at)} · {ev.venue}</div>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="audience">
        <Audience title="For students" icon="user">
          Browse societies, request to join, register for events with a public link, and keep track of your volunteer tasks.
        </Audience>
        <Audience title="For organisers" icon="building">
          Run members, events, volunteers, the task board and spending against an approved budget, all in one place.
        </Audience>
        <Audience title="For the university" icon="shield">
          Review event proposals and budgets, and see registrations, task progress and spending across every society.
        </Audience>
      </section>

      <section className="section">
        <h2 className="section-title">Upcoming events</h2>
        <Alert>{error}</Alert>
        {data && data.length === 0 && <Empty>No upcoming approved events yet.</Empty>}
        <div className="grid">
          {data?.map((ev) => <EventCard key={ev.id} ev={ev} />)}
        </div>
      </section>
    </>
  );
}
