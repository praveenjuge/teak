import { execFile } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface SourceMapUpload {
  releaseName: string;
  releaseVersion: string;
}

const removeSourceMaps = async (directory: string): Promise<number> => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const maps = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".map")
  );
  await Promise.all(
    maps.map((entry) => unlink(path.join(entry.parentPath, entry.name)))
  );
  return maps.length;
};

/**
 * Uploads the browser bundle's source maps to PostHog, then deletes every
 * `.map` file so source is never served. Turbopack's native debug IDs tie each
 * chunk to its map, so the built JavaScript is never rewritten and its SRI
 * hashes stay valid. Server chunks are skipped: server errors are reported
 * with raw frames and Next ships some server chunks without debug IDs.
 *
 * Uploading is best effort; a PostHog outage must never fail a deploy.
 */
export const uploadBrowserSourceMaps = async (
  distDir: string,
  { releaseName, releaseVersion }: SourceMapUpload
): Promise<void> => {
  const staticDir = path.join(distDir, "static");
  try {
    const cli = createRequire(import.meta.url).resolve(
      "@posthog/cli/run-posthog-cli.js"
    );
    await run(
      process.execPath,
      [
        cli,
        "sourcemap",
        "upload",
        "--directory",
        staticDir,
        "--release-name",
        releaseName,
        "--release-version",
        releaseVersion,
      ],
      { env: process.env, maxBuffer: 16 * 1024 * 1024 }
    );
    console.info("[posthog] Uploaded browser source maps");
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).slice(-2000)
        : String(error);
    console.warn(`[posthog] Source map upload failed; continuing.\n${detail}`);
  } finally {
    const removed = await removeSourceMaps(staticDir);
    console.info(`[posthog] Removed ${removed} browser source maps`);
  }
};
