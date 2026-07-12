import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import { sentryDesktopPlugins } from "./vite.sentry";

/**
 * Vite config for the Electron main process.
 *
 * This config is consumed in two places:
 *
 * 1. `electron-forge start` (dev) — `@electron-forge/plugin-vite` wraps it,
 *    injects `MAIN_WINDOW_VITE_DEV_SERVER_URL` / `MAIN_WINDOW_VITE_NAME`,
 *    and handles externalization.
 * 2. `bun run build` (prod) — we invoke `vite build` directly, so we have
 *    to replicate plugin-vite's behaviour manually: correct outDir, the
 *    two Forge globals, and externals for electron + node builtins.
 *
 * The final artifact lands at `.vite/build/main.js`, matching the `main`
 * field in package.json.
 */
export default defineConfig(({ command }) => ({
  build: {
    outDir: ".vite/build",
    // Preload shares this outDir; don't wipe it when main builds.
    emptyOutDir: false,
    lib: {
      entry: "src/main/bootstrap.ts",
      fileName: () => "main.js",
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        // Keep the Electron SDK in its native Node module boundary. Bundling
        // its require-in-the-middle instrumentation into this ESM entry leaves
        // CommonJS globals such as `require.cache` undefined at runtime.
        "@sentry/electron/main",
        "electron",
        "electron-updater",
        "electron-store",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    sourcemap: "hidden",
    minify: false,
    target: "node20",
  },
  plugins: sentryDesktopPlugins(
    ".vite/build/**/*.{js,map}",
    ".vite/build/**/*.map"
  ),
  // Only inject the Forge globals during `vite build` (production).
  // In `electron-forge start`, plugin-vite injects them with live values
  // and we must not clobber them here.
  define:
    command === "build"
      ? {
          MAIN_WINDOW_VITE_DEV_SERVER_URL: "undefined",
          MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
        }
      : undefined,
}));
