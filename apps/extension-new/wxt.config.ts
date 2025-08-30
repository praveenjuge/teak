import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    // Add key for consistent CRX ID during development
    ...(mode === 'development' && process.env.CRX_PUBLIC_KEY && {
      key: process.env.CRX_PUBLIC_KEY,
    }),
    permissions: [
      'storage',
      'cookies'
    ],
    host_permissions: [
      'http://localhost/*',
      'https://*.clerk.accounts.dev/*',
      'https://*.clerk.com/*'
    ],
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
