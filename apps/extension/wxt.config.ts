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
    permissions: ['storage', 'activeTab', 'tabs', 'contextMenus', 'scripting', 'cookies'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Save to Teak',
    },
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkgJrENYninAOCgkpb9LcU6i5/lDbBjNjWBi0VF8iRg+Ha91Gx/0S9jtL1h36kAGXetcNvxXeJ95UE+HG9Dd8UfyhM9kuBh+o6/zsu8L7vFdVOH1EdVPvO15jVoa2e8DOYz/f0EN/FJ7G6QDm411110NHxVleQc0SEe35FZwTDTX6T1lC9XeYtE+y6eU+fUlLZF1/JJL+lIlXjaLnB4QQTJhK9KQvOi2LVtFUHUYVYV/Jebj3VFdj8gOVS2iTIfYrcb0oInFCwxnBStflQR9604XAqZBUt2KEWgO9V/cUHmdfoHHmXZ7k/1+d498nA7tKg1O9+0eZUUDlxmtv5jOM4QIDAQAB",
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
