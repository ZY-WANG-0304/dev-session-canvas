import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/templates/',
  plugins: [react()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  }
});
