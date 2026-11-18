import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { userFromToken } from './lib/auth.js';
import { attachRealtime } from './lib/realtime.js';

const PORT = Number(process.env.PORT) || 4000;

const app = createApp();
const server = http.createServer(app);
const io = new Server(server);
attachRealtime(io);

// Sockets may connect anonymously (public event pages show live seat counts).
// A valid token joins the user's private room for notifications and dashboard refreshes.
io.use((socket, next) => {
  try {
    socket.data.user = userFromToken(socket.handshake.auth?.token ?? '');
  } catch {
    socket.data.user = null;
  }
  next();
});

io.on('connection', (socket) => {
  if (socket.data.user) socket.join(`user:${socket.data.user.id}`);

  socket.on('event:join', (eventId) => {
    if (/^\d+$/.test(String(eventId))) socket.join(`event:${eventId}`);
  });
  socket.on('event:leave', (eventId) => {
    if (/^\d+$/.test(String(eventId))) socket.leave(`event:${eventId}`);
  });
});

server.listen(PORT, () => {
  console.log(`UniSphere API listening on http://localhost:${PORT}`);
});
