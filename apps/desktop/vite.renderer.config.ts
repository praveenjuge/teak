import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the Electron renderer (React frontend).
 *
 * Preserves the monorepo singleton aliases/dedupe that the previous
 * `electron.vite.config.ts` had so Convex/React stay as a single instance.
 *
 * `base: "./"` ensures assets resolve correctly when the built HTML is
 * loaded via `file://` in production.
 */
const workspaceRoot = path.resolve(import.meta.dirname, "../..");

function rootPkg(name: string): string {
  return path.resolve(workspaceRoot, "node_modules", name);
}

const singletonAliases = {
  convex: rootPkg("convex"),
  "convex/react": rootPkg("convex/react"),
  "convex/browser": rootPkg("convex/browser"),
  "convex-helpers": rootPkg("convex-helpers"),
  react: rootPkg("react"),
  "react-dom": rootPkg("react-dom"),
} as const;
const singletonDedupe = ["convex", "convex-helpers", "react", "react-dom"];

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      ...singletonAliases,
    },
    dedupe: singletonDedupe,
  },
  server: {
    port: 1420,
  },
});
