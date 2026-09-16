import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@acr-js/opsroom-core': path.resolve(import.meta.dirname, '../core/src'),
    },
  },
  server: {
    port: 30447,
    host: true,
  },
});
