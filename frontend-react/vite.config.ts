import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Backend (Express) the dev server proxies to so the session cookie stays same-origin.
const BACKEND = 'http://localhost:3000'

// Backend-owned path prefixes. Everything else is handled by the React router.
// These are proxied to Express in dev so auth/session/CSRF behave exactly as today.
const proxyPaths = [
  '/api',
  '/login',
  '/reauth',
  '/callback',
  '/health',
  // Admin: only the API + password-login/logout stay on the backend; the admin
  // UI routes (/admin, /admin/users, ...) are now React-owned.
  '/admin/api',
  '/admin/login',
  '/admin/logout',
  '/internal',
  '/stats.json',
  '/force-stats',
  '/users',
  '/privacy.md',
  '/terms.md',
  '/sitemap.xml',
  // Static data files + uploaded assets served by the backend.
  '/drops.json',
  '/uploads',
  // OBS overlays: legacy static .html files stay on the backend so existing OBS
  // browser-source URLs keep working. React overlay routes live under /overlay/*.
  '/overlays',
  // Statistics dashboard is React-owned; only the password login stays on the backend.
  '/statistics/login',
  // Backend pages not yet migrated to React.
  '/botmetrics',
  '/analytics-dashboard',
  '/docs-markdown',
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      proxyPaths.map((p) => [p, { target: BACKEND, changeOrigin: false }]),
    ),
  },
})
