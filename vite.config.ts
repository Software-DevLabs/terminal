import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ptyPort = Number(process.env.MACTERM_PORT ?? 53124);
const ptyTarget = `http://127.0.0.1:${ptyPort}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __MACTERM_TOKEN__: JSON.stringify(process.env.MACTERM_TOKEN ?? ''),
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.MACTERM_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/config': ptyTarget,
      '/health': ptyTarget,
      '/workspace': ptyTarget,
      '/pty': { target: ptyTarget, ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
