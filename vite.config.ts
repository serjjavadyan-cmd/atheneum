import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Electron loads the built files from disk via file://, so assets must be relative.
  base: './',
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
