import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const defaultAllowedHosts = ['dailydf.silverspace.tech', 'dailydf.tunn.dev'];

// One id per build — embedded in the bundle (__BUILD_ID__) AND emitted as
// /version.json. UpdateGuard polls the file and reloads the app when they
// diverge, so deploys reach every open tab without a manual hard refresh.
const buildId = new Date().toISOString();

const emitVersionJson = () => ({
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({
      type: 'asset' as const,
      fileName: 'version.json',
      source: JSON.stringify({ buildId }),
    });
  },
});

const resolveAllowedHosts = (rawHosts?: string) => {
  if (!rawHosts) {
    return defaultAllowedHosts;
  }

  if (rawHosts === 'true' || rawHosts === '*') {
    return true;
  }

  return rawHosts
    .split(',')
    .map((hostName) => hostName.trim())
    .filter(Boolean);
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8180,
    open: false,
  },
  preview: {
    port: 8180,
    host: '::',
    allowedHosts: resolveAllowedHosts(process.env.FRONTEND_ALLOWED_HOSTS),
    // no-cache ≠ no-store: browsers may keep copies but must revalidate, so
    // a plain location.reload() always picks up a freshly deployed
    // index.html/version.json (hashed assets just 304).
    headers: { 'Cache-Control': 'no-cache' },
  },
  plugins: [react(), emitVersionJson()].filter(Boolean),
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'chart-vendor': ['recharts'],
          'radix-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select',
            '@radix-ui/react-dropdown-menu',
          ],
          'icon-vendor': ['lucide-react'],
          'date-vendor': ['date-fns', 'moment', 'moment-timezone'],
        },
      },
    },
  },
}));
