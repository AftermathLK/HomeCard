import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.HOMECARD_API ?? 'http://127.0.0.1:8787';

/** Dev server only: serve the sign-in page for /login, /setup and /register like the API server does. */
function authPages(): Plugin {
  return {
    name: 'homecard-auth-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [p, q] = (req.url ?? '').split('?');
        if (/^\/(login|setup|register)\/?$/.test(p)) req.url = `/auth.html${q ? `?${q}` : ''}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), authPages()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/fonts': { target: api, changeOrigin: false },
      '/health': { target: api, changeOrigin: false },
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    // The server reads the manifest to learn which files the signed-out login page may load.
    manifest: true,
    rollupOptions: {
      // Entry points: the app, the sign-in page, and the headless print renderer used by exports.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        auth: fileURLToPath(new URL('./auth.html', import.meta.url)),
        render: fileURLToPath(new URL('./render.html', import.meta.url)),
      },
    },
  },
});
