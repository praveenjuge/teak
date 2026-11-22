import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import packageJson from "./package.json" with { type: "json" };
import { resolveCommitSha } from "./scripts/build-env.ts";
import { installFilesPlugin } from "./scripts/installFilesPlugin.ts";
import { resolvePostHogToken } from "./src/lib/analyticsGate.ts";

// One copy each of React and Convex: a second copy breaks hooks and the
// Convex client's shared cache.
const singletons = ["convex", "convex-helpers", "react", "react-dom"] as const;

export default defineConfig(({ mode }) => {
  // The env files `bun run setup` writes, plus the build's own environment.
  const env = { ...loadEnv(mode, import.meta.dirname, ""), ...process.env };
  const posthogToken = resolvePostHogToken({
    analyticsEnabled: env.TEAK_ANALYTICS_ENABLED,
    // Read from the environment, not a hard-coded token.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    token: env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
  });
  const uploadSourceMaps = Boolean(
    posthogToken &&
      env.POSTHOG_CLI_API_KEY?.trim() &&
      env.POSTHOG_CLI_PROJECT_ID?.trim()
  );
  // Vite inlines the VITE_PUBLIC_* values from the env files and the build's
  // environment by itself. These three are worked out here: the release, and
  // the PostHog token, which only an analytics-enabled build may ship.
  const computedValues = {
    VITE_PUBLIC_APP_VERSION: packageJson.version,
    VITE_PUBLIC_COMMIT_SHA: resolveCommitSha(env) ?? "",
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: posthogToken ?? "",
  };
  return {
    server: {
      port: Number(env.PORT ?? 3000),
      strictPort: true,
    },
    define: Object.fromEntries(
      Object.entries(computedValues).map(([name, value]) => [
        `import.meta.env.${name}`,
        JSON.stringify(value),
      ])
    ),
    resolve: {
      alias: [{ find: /^@\//, replacement: `${path.resolve("src")}/` }],
      // Resolved from the app root through each package's exports map, so a
      // package that moves its files (convex-helpers into dist/) still works.
      dedupe: [...singletons],
    },
    build: {
      // Hidden maps are uploaded to PostHog after the build, then deleted.
      sourcemap: uploadSourceMaps ? "hidden" : false,
    },
    environments: {
      // The Worker's maps go to Cloudflare with the deploy (wrangler.jsonc,
      // `upload_source_maps`), so Workers Issues shows source lines.
      ssr: { build: { sourcemap: true } },
    },
    plugins: [
      installFilesPlugin(),
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tailwindcss(),
      tanstackStart({
        importProtection: {
          behavior: "error",
          // @teak/convex's entry is named index.client.ts only so Convex
          // doesn't bundle it as a function module; it is safe on the server.
          server: { excludeFiles: ["**/packages/convex/index.client.ts"] },
        },
      }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
    ],
  };
});
