import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/admin': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      '/news': 'http://localhost:3001',
      '/payments': 'http://localhost:3001',
      '/support': 'http://localhost:3001',
      '/tournaments': 'http://localhost:3001',
      '/users': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
  },
});
