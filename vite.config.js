import { defineConfig } from 'vite';
export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5176',
    },
  },
});
