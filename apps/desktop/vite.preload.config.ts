import { builtinModules } from "node:module";
import { defineConfig } from "vite";

/**
 * Vite config for the Electron preload script.
 *
 * Preload runs in a sandboxed renderer and must be CJS.
 *
 * Important: in dev, `@electron-forge/plugin-vite` overrides our `lib`
 * config and uses `rollupOptions.input = src/preload/index.ts` with
 * `entryFileNames: "[name].js"` — which would emit `index.js`, not
 * the `preload.js` our main process loads. We pin
 * `rollupOptions.output.entryFileNames` so the filename is stable
 * in both dev (Forge-orchestrated) and prod (direct `vite build`) modes.
 *
 * Output: `.vite/build/preload.js`, loaded by the main process via
 * `webPreferences.preload` (see src/main/index.ts).
 */
export default defineConfig({
  build: {
    outDir: ".vite/build",
    // Main shares this outDir; don't wipe it when preload builds.
    emptyOutDir: false,
    lib: {
      entry: "src/preload/index.ts",
      fileName: () => "preload.js",
      formats: ["cjs"],
    },
    rollupOptions: {
      // Pin the output filename so Forge's `[name].js` template can't
      // turn this into `index.js` during `electron-forge start`.
      output: {
        entryFileNames: "preload.js",
      },
      external: [
        "electron",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    sourcemap: "inline",
    minify: false,
    target: "node20",
  },
});
