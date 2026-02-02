import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const defaultAllowedHosts = ['dailydf.silverspace.tech', 'dailydf.tunn.dev'];

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
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
