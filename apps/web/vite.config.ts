import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from "path"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react({
      babel: {
        plugins: [
          [
            'babel-plugin-react-compiler',
            {
              runtime: 'automatic',
            },
          ],
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: [
      '@tanstack/react-router-devtools',
      '@tanstack/react-query-devtools'
    ],
    include: [
      'react-dom/client',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'better-auth/react',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      'class-variance-authority',
      'clsx',
      'tailwind-merge'
    ]
  },
  server: {
    host: '0.0.0.0', // Allow external connections (required for Docker)
    port: 3000,
    watch: {
      usePolling: true, // Required for file watching in Docker
    },
    hmr: {
      port: 3000,
    },
    proxy: {
      '/api': {
        target: process.env['VITE_API_URL'] || 'http://backend:3001',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
