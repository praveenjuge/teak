import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: Number(process.env.PORT ?? 5610), strictPort: true },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        // @teak/convex's entry is named index.client.ts only so Convex does
        // not bundle it as a function module; it is safe on the server.
        server: { excludeFiles: ["**/packages/convex/index.client.ts"] },
      },
    }),
    react(),
  ],
});
