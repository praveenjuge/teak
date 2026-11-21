import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import packageJson from "./package.json" with { type: "json" };
import { resolveCommitSha } from "./scripts/build-env.ts";
import { resolvePostHogToken } from "./src/lib/analyticsGate.ts";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

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
    token: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  });
  const uploadSourceMaps = Boolean(
    posthogToken &&
      env.POSTHOG_CLI_API_KEY?.trim() &&
      env.POSTHOG_CLI_PROJECT_ID?.trim()
  );
  // Values the browser and the Worker read at build time, under the names
  // the env contract (scripts/env) gives them.
  const publicValues: Record<string, string | undefined> = {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(env),
    NEXT_PUBLIC_CONVEX_SITE_URL: env.NEXT_PUBLIC_CONVEX_SITE_URL,
    NEXT_PUBLIC_CONVEX_URL: env.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_FILES_BASE: env.NEXT_PUBLIC_FILES_BASE,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: posthogToken ?? "",
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  };
  return {
    server: {
      port: Number(env.PORT ?? 3000),
      strictPort: true,
    },
    define: Object.fromEntries(
      Object.entries(publicValues).map(([name, value]) => [
        `process.env.${name}`,
        JSON.stringify(value ?? ""),
      ])
    ),
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${path.resolve("src")}/` },
        ...singletons.map((name) => ({
          // Built from the fixed package names above, never from input.
          // nosemgrep: javascript_dos_rule-non-literal-regexp
          find: new RegExp(`^${name}(/.*)?$`),
          replacement: `${path.join(workspaceRoot, "node_modules", name)}$1`,
        })),
      ],
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
