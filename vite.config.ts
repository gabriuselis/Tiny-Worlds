import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: false,
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/tests/**', '**/*.log'],
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
});
