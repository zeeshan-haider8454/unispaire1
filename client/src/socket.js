import { io } from 'socket.io-client';
import { tokenStore } from './api.js';

let socket = null;

// One shared connection. It is rebuilt after login or logout so the token in the handshake is current.
export function getSocket() {
  if (!socket) {
    socket = io({ auth: { token: tokenStore.get() } });
  }
  return socket;
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}
