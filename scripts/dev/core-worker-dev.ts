#!/usr/bin/env bun
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../../apps/core-worker/development/wrangler.jsonc";
import { parseDotenvContent } from "../env/env-loader";
import {
  assertDevelopmentWorkerConfig,
  assertIsolatedDevelopmentFiles,
  readDevelopmentFilesRouting,
} from "./core-worker-dev-boundary";

const root = join(import.meta.dir, "../..");
const worker = join(root, "apps/core-worker");
if (process.argv.length > 2) {
  throw new Error("The core worker dev script takes no arguments.");
}
assertDevelopmentWorkerConfig(config);
const secret = assertIsolatedDevelopmentFiles(
  await readDevelopmentFilesRouting(root)
);
const local = await readFile(
  join(worker, "development/.dev.vars"),
  "utf8"
).catch(() => "");
const localSecret = Buffer.from(
  parseDotenvContent(local).values.get("FILES_SIGNING_SECRET") ?? ""
);
const convexSecret = Buffer.from(secret);
if (
  localSecret.length !== convexSecret.length ||
  !timingSafeEqual(localSecret, convexSecret)
) {
  throw new Error(
    "development/.dev.vars does not hold the Convex dev signing key; run `bun run sync:cloudflare-dev --isolated`."
  );
}
const env = {
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
