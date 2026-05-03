import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

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
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: ".",
    build: {
      rollupOptions: {
        input: path.resolve(import.meta.dirname, "index.html"),
      },
    },
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
  },
});
