import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Teak',
    description: 'Your personal knowledge hub. Save, organize, and rediscover web content effortlessly.',
    version: '1.0.0',
    author: {
      email: "hi@praveenjuge.com"
    },
    homepage_url: 'https://teakvault.com',
    permissions: ['storage', 'activeTab', 'tabs', 'contextMenus', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Save to Teak',
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png'
    }
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
