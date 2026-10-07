#!/usr/bin/env bun
/**
 * Local Files Worker code against the isolated development bucket and AI.
 * Refuses to start until Convex dev uses the isolated development Worker, so
 * it never writes to the new bucket before the approved storage switch.
 * `bun run dev:files` keeps today's shared production routing.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../apps/files-worker/development/wrangler.jsonc";
import { parseDotenvContent } from "./env-loader";
import {
  assertDevelopmentWorkerConfig,
  assertIsolatedDevelopmentFiles,
  readDevelopmentFilesRouting,
} from "./files-worker-dev-boundary";

const root = join(import.meta.dir, "..");
const worker = join(root, "apps/files-worker");
if (process.argv.length > 2) {
  throw new Error("dev:development takes no arguments.");
}
assertDevelopmentWorkerConfig(config);
const secret = assertIsolatedDevelopmentFiles(
  await readDevelopmentFilesRouting(root)
);
const local = await readFile(
  join(worker, "development/.dev.vars"),
  "utf8"
).catch(() => "");
if (parseDotenvContent(local).values.get("FILES_SIGNING_SECRET") !== secret) {
  throw new Error(
    "development/.dev.vars does not hold the Convex dev signing key; run `bun run sync:cloudflare-dev -- --isolated`."
  );
}
const env = {
  // Only development/.dev.vars supplies secrets; the config pins the account.
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "CLOUDFLARE_ACCOUNT_ID"
    )
  ),
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
};
const proc = Bun.spawn(
  [
    "bunx",
    "wrangler",
    "dev",
    "--remote",
    "--config",
    "development/wrangler.jsonc",
  ],
  { cwd: worker, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" }
);
process.exit(await proc.exited);
