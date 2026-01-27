import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

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
    // allowedHosts: ['dailydf.tunn.dev', 'dailydf.silverspace.tech'], // Disabled to allow Gateway proxying
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));