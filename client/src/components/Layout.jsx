import { startTransition, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { formatPKT } from '../format.js';

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback((unreadOnly = false) => {
    api(`/notifications${unreadOnly ? '?unread=1' : ''}`)
      .then((data) => {
        setItems(data.notifications);
        setUnread(data.unread);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(onlyUnread);
    const socket = getSocket();
    // Notifications arrive live, without a page refresh.
    const onNotification = (note) => {
      setItems((prev) => (onlyUnread ? prev : [note, ...prev]).slice(0, 50));
      setUnread((n) => n + 1);
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [load, onlyUnread]);

  // Marks one notification read when it is opened, then follows its link.
  function openItem(n) {
    setOpen(false);
    if (!n.is_read) {
      api(`/notifications/${n.id}/read`, { method: 'POST' })
        .then(() => {
          setUnread((c) => Math.max(c - 1, 0));
          setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
        })
        .catch(() => {});
    }
  }

  function markAllRead() {
    api('/notifications/read-all', { method: 'POST' })
      .then(() => {
        setUnread(0);
        setItems((prev) => (onlyUnread ? [] : prev.map((n) => ({ ...n, is_read: 1 }))));
      })
      .catch(() => {});
  }

  return (
    <div className="bell">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        Notifications {unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-bar">
            <div className="segmented" role="group" aria-label="Filter notifications">
              <button type="button" className={!onlyUnread ? 'active' : ''} onClick={() => setOnlyUnread(false)}>All</button>
              <button type="button" className={onlyUnread ? 'active' : ''} onClick={() => setOnlyUnread(true)}>Unread</button>
            </div>
            <button type="button" className="btn btn-small btn-ghost" onClick={markAllRead} disabled={unread === 0}>
              Mark all read
            </button>
          </div>
          {items.length === 0 && <p className="muted">{onlyUnread ? 'No unread notifications.' : 'No notifications yet.'}</p>}
          {items.map((n) => (
            <Link
              key={n.id}
              to={n.link || '/'}
              className={n.is_read ? 'note' : 'note unread'}
              onClick={() => openItem(n)}
            >
              <span>{n.message}</span>
              <small className="muted">{formatPKT(n.created_at)}</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  function logout() {
    // Navigate and clear the user in one transition, so route guards on the current page
    // don't redirect to login before the move to the home page.
    startTransition(() => {
      navigate('/');
      signOut();
    });
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">UniSphere</Link>
        <nav className="nav">
          <NavLink to="/events">Events</NavLink>
          {user?.role === 'student' && (
            <>
              <NavLink to="/student">My dashboard</NavLink>
              <NavLink to="/societies">Societies</NavLink>
            </>
          )}
          {user?.role === 'president' && (
            <>
              <NavLink to="/president">My society</NavLink>
              <NavLink to="/president#events">Manage events</NavLink>
            </>
          )}
          {user?.role === 'admin' && <NavLink to="/admin">Administration</NavLink>}
          {!user && (
            <>
              <NavLink to="/login">Log in</NavLink>
              <NavLink to="/register" className="btn btn-small">Sign up</NavLink>
            </>
          )}
        </nav>
        {user && (
          <div className="user-area">
            <NotificationBell />
            <span className="user-name">{user.name}</span>
            <button className="btn btn-ghost" onClick={logout}>Log out</button>
          </div>
        )}
      </header>
      <main className="container">
        <Outlet />
      </main>
      <footer className="footer muted">UniSphere · Event times shown in Pakistan Standard Time (PKT)</footer>
    </>
  );
}
