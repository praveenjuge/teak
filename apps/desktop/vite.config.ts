import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const singletonAliases = {
  convex: path.resolve(workspaceRoot, "node_modules/convex"),
  "convex/react": path.resolve(workspaceRoot, "node_modules/convex/react"),
  "convex/browser": path.resolve(workspaceRoot, "node_modules/convex/browser"),
  "convex-helpers": path.resolve(workspaceRoot, "node_modules/convex-helpers"),
  react: path.resolve(workspaceRoot, "node_modules/react"),
  "react-dom": path.resolve(workspaceRoot, "node_modules/react-dom"),
} as const;
const singletonDedupe = ["convex", "convex-helpers", "react", "react-dom"];

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      ...singletonAliases,
    },
    dedupe: singletonDedupe,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
