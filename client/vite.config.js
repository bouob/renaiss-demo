import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deployment invariant (PLAN.md §部署 / §架構):
// served at dokipoki-dev.web.app/merchant, so every asset URL and route
// must be rooted at /merchant/ — otherwise absolute-path assets 404 once
// mounted under that subpath.
export default defineConfig({
  base: '/merchant/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Local dev only: the standalone merchantApi Express server (TASK-001)
      // is expected on this port. Override with a different port there if
      // needed — this proxy has no effect on the built production bundle.
      '/merchant/api': {
        // Matches server/index.js default PORT (3101)
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
    },
  },
});
