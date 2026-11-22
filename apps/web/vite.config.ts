import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import packageJson from "./package.json" with { type: "json" };
import { resolveCommitSha } from "./scripts/build-env.ts";
import { resolvePostHogToken } from "./src/lib/analyticsGate.ts";
import { installFiles } from "./src/lib/installFiles.ts";

// One copy each of React and Convex: a second copy breaks hooks and the
// Convex client's shared cache.
const singletons = ["convex", "convex-helpers", "react", "react-dom"] as const;

// The web app manifest and the share service worker, written as static files
// so they are served from the edge without running the Worker.
function installFilesPlugin(): Plugin {
  return {
    name: "teak:install-files",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = installFiles.find(
          ({ path }) => path === request.url?.split("?")[0]
        );
        if (!file) {
          next();
          return;
        }
        response.setHeader("Content-Type", file.contentType);
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Service-Worker-Allowed", "/");
        response.end(file.source);
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") {
        return;
      }
      for (const { path, source } of installFiles) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source });
      }
    },
  };
}

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
