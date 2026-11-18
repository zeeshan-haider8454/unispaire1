import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API and Socket.IO run on port 4000. The dev server proxies both, so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
