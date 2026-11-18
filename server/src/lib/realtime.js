import { db } from '../db.js';

// Set once the Socket.IO server is attached in index.js.
let io = null;
export function attachRealtime(server) {
  io = server;
}

const uniqueIds = (ids) => [...new Set(ids.filter((id) => Number.isInteger(id)))];

// Stores an in-app notification and pushes it to the user's socket room.
export function notify(userIds, { type, message, link = '' }) {
  const insert = db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)');
  for (const userId of uniqueIds(userIds)) {
    const info = insert.run(userId, type, message, link);
    io?.to(`user:${userId}`).emit('notification', {
      id: Number(info.lastInsertRowid),
      type,
      message,
      link,
      is_read: 0,
      created_at: new Date().toISOString(),
    });
  }
}

export function adminIds() {
  return db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((row) => row.id);
}

export function notifyAdmins(payload) {
  notify(adminIds(), payload);
  signal(adminIds(), 'admin');
}

// Tells connected dashboards to refetch. The payload carries no private data.
export function signal(userIds, scope) {
  for (const userId of uniqueIds(userIds)) {
    io?.to(`user:${userId}`).emit('data:changed', { scope });
  }
}

// Broadcasts a public update to everyone viewing an event page (live seat counts and status).
export function emitEvent(eventId, payload = {}) {
  io?.to(`event:${eventId}`).emit('event:updated', { eventId: Number(eventId), ...payload });
}
