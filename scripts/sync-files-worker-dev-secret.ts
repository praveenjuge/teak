#!/usr/bin/env bun

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConvexEnvOutput } from "./check-cloudflare";

const root = join(import.meta.dir, "..");
const convexPath = join(root, "packages/convex");
const devVarsPath = join(root, "apps/files-worker/.dev.vars");

// biome-ignore lint/correctness/noUndeclaredVariables: Bun global in Bun runtime
const proc = Bun.spawn(
  [
    "bunx",
    "convex",
    "env",
    "get",
    "FILES_SIGNING_SECRET",
    "--deployment",
    "dev",
  ],
  { cwd: convexPath, stderr: "pipe", stdout: "pipe" }
);
await proc.exited;
const result = parseConvexEnvOutput(
  await new Response(proc.stdout).text(),
  await new Response(proc.stderr).text(),
  proc.exitCode
);

if (result.status !== "found") {
  throw new Error(
    result.status === "missing"
      ? "Convex dev FILES_SIGNING_SECRET is missing"
      : "Convex dev environment is unavailable"
  );
}
if (/[\r\n\0]/.test(result.value)) {
  throw new Error("Convex dev FILES_SIGNING_SECRET has an unsafe dotenv value");
}

await writeFile(devVarsPath, `FILES_SIGNING_SECRET=${result.value}\n`, {
  mode: 0o600,
});
await chmod(devVarsPath, 0o600);
console.log(
  "Synced Convex dev FILES_SIGNING_SECRET to ignored apps/files-worker/.dev.vars"
);
