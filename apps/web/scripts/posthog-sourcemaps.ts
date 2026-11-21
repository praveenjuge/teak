import { execFile } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { loadEnv } from "vite";
import packageJson from "../package.json" with { type: "json" };
import { resolvePostHogToken } from "../src/lib/analyticsGate";
import { resolveCommitSha } from "./build-env";

const run = promisify(execFile);
const appRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(appRoot, "dist");

const removeSourceMaps = async (directory: string): Promise<number> => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  const maps = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".map")
  );
  await Promise.all(
    maps.map((entry) => unlink(path.join(entry.parentPath, entry.name)))
  );
  return maps.length;
};

/**
 * After `vite build`: tags each browser chunk with a PostHog chunk ID,
 * uploads the browser source maps under this release, then deletes them so
 * source is never served. The Worker's own maps stay: Wrangler uploads them
 * to Cloudflare for Workers Issues, and they are never served. It runs only
 * for builds that report
 * to PostHog with CLI credentials (vite.config.ts writes hidden maps then).
 * Uploading is best effort; a PostHog outage must never fail a deploy.
 */
const main = async () => {
  const env = { ...loadEnv("production", appRoot, ""), ...process.env };
  const reports = resolvePostHogToken({
    analyticsEnabled: env.TEAK_ANALYTICS_ENABLED,
    // Read from the environment, not a hard-coded token.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    token: env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
  });
  if (
    !(
      reports &&
      env.POSTHOG_CLI_API_KEY?.trim() &&
      env.POSTHOG_CLI_PROJECT_ID?.trim()
    )
  ) {
    return;
  }
  const sha = resolveCommitSha(env);
  const release = [
    "--release-name",
    "teak-web",
    "--release-version",
    sha ? `${packageJson.version}+${sha.slice(0, 12)}` : packageJson.version,
  ];
  const clientDir = path.join(distDir, "client");
  try {
    const cli = createRequire(import.meta.url).resolve(
      "@posthog/cli/run-posthog-cli.js"
    );
    const posthog = (args: string[]) =>
      run(process.execPath, [cli, "sourcemap", ...args], {
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      });
    await posthog(["inject", "--directory", clientDir, ...release]);
    await posthog(["upload", "--directory", clientDir, ...release]);
    console.info("[posthog] Uploaded browser source maps");
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).slice(-2000)
        : String(error);
    console.warn(`[posthog] Source map upload failed; continuing.\n${detail}`);
  } finally {
    const removed = await removeSourceMaps(clientDir);
    console.info(`[posthog] Removed ${removed} source maps`);
  }
};

await main();
