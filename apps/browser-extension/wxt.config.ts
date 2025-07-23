import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  dev: {
    server: {
      port: 3010,
    },
  },
  manifest: {
    permissions: ['tabs', 'activeTab'],
  },
});
