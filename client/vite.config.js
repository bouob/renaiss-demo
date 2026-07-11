import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dual deploy modes:
// - Path (default): MERCHANT_BASE=/merchant/ → dokipoki-dev.web.app/merchant/
// - Root site:      MERCHANT_BASE=/         → merchant.dokipoki.app/ (multi-site)
const base = process.env.MERCHANT_BASE || '/merchant/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Local: both path-style and root-style API prefixes → Express
      '/merchant/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, '/merchant/api'),
      },
    },
  },
});
