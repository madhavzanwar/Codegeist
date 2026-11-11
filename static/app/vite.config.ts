import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `--mode mock` swaps @forge/bridge for an in-browser mock backed by the real risk engine,
// so the UI can be developed and screenshotted without a Jira site.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: (mode === 'mock' ? { '@forge/bridge': fileURLToPath(new URL('./src/mock/bridge.ts', import.meta.url)) } : {}) as Record<string, string>,
  },
  build: { outDir: mode === 'mock' ? 'build-mock' : 'build', sourcemap: false, chunkSizeWarningLimit: 800 },
}));
