import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/healthz': 'http://127.0.0.1:8787',
    },
  },
});
