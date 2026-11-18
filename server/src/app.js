import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import societyRoutes from './routes/societies.js';
import eventRoutes from './routes/events.js';
import meetingRoutes from './routes/meetings.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { AppError } from './lib/errors.js';
import { smtpConfigured } from './lib/mailer.js';
import { openApiSpec, swaggerPage } from './openapi.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, emailConfigured: smtpConfigured }));

  // API documentation: OpenAPI JSON and Swagger UI (UI loads from unpkg.com).
  app.get('/api/openapi.json', (req, res) => res.json(openApiSpec));
  app.get('/api/docs', (req, res) => res.type('html').send(swaggerPage));
  app.use('/api/auth', authRoutes);
  app.use('/api/societies', societyRoutes);
  app.use('/api', meetingRoutes); // meetings and meeting invitations
  app.use('/api', eventRoutes); // events, registrations, invitations, tasks, expenses
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);

  // If the React build exists (npm run build in client/), serve it from the same origin.
  const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      return res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
