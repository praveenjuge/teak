import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

/**
 * Electron Forge is used only for the dev loop (`electron-forge start`).
 * Production packaging, signing, notarization, and GitHub release publishing
 * are still handled by `electron-builder` — see `electron-builder.config.ts`.
 */
const config: ForgeConfig = {
  packagerConfig: {
    name: "Teak",
    asar: true,
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
