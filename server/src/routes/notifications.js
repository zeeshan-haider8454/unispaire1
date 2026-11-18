import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

const router = Router();
router.use(requireAuth);

// ?unread=1 returns only unread notifications. The unread count always covers every notification.
router.get('/', (req, res) => {
  const onlyUnread = req.query.unread === '1' || req.query.unread === 'true';
  const notifications = db.prepare(`
    SELECT id, type, message, link, is_read, created_at
    FROM notifications WHERE user_id = ? ${onlyUnread ? 'AND is_read = 0' : ''}
    ORDER BY id DESC LIMIT 50`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
  res.json({ notifications, unread });
});

// Marks one notification as read. Only the recipient can change it.
router.post('/:id/read', (req, res) => {
  const info = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!info.changes) throw new AppError(404, 'Notification not found.');
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
