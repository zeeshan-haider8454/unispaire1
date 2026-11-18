import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { getSocket } from './socket.js';

// Fetches JSON from the API. reload() refetches, and stale responses are ignored.
export function useApi(path, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: enabled });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !path) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => !cancelled && setState({ data, error: '', loading: false }))
      .catch((err) => !cancelled && setState({ data: null, error: err.message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, enabled, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

// Calls onChange when the server reports a change for this user (membership, tasks, registrations, etc.).
export function useDataChanged(onChange) {
  useEffect(() => {
    const socket = getSocket();
    socket.on('data:changed', onChange);
    return () => socket.off('data:changed', onChange);
  }, [onChange]);
}

// Joins an event's room so the page receives live seat counts and status changes.
export function useEventRoom(eventId, onUpdate) {
  useEffect(() => {
    if (!eventId) return undefined;
    const socket = getSocket();
    const join = () => socket.emit('event:join', eventId);
    join();
    socket.on('connect', join);
    socket.on('event:updated', onUpdate);
    return () => {
      socket.emit('event:leave', eventId);
      socket.off('connect', join);
      socket.off('event:updated', onUpdate);
    };
  }, [eventId, onUpdate]);
}
