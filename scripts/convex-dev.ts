#!/usr/bin/env bun
/**
 * `convex dev` for Turbo targets (`bun run dev extension`, `--all`). A local
 * backend binds this checkout's ports, the ones setup wrote into the env
 * files; a cloud deployment binds none.
 */

import { join } from "node:path";
import {
  isStackRunning,
  readStackState,
} from "../packages/tests/src/stack/config.ts";
import { readConvexSelection } from "./capabilities.ts";
import { localBackendArgs } from "./setup-convex.ts";
import { isLocalSelection } from "./setup-mode.ts";
import { resolveWorktree } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");

// `bun run dev` already runs this checkout's backend and pushes changes, so a
// Turbo surface started beside it (`bun run dev extension`) shares it.
const stack = readStackState();
if (stack && isStackRunning(stack)) {
  console.log(
    `Using this checkout's running stack backend at ${stack.urls.convexUrl}.`
  );
  await new Promise(() => undefined);
}
const CONVEX_DIR = join(ROOT, "packages/convex");

const { deployment } = readConvexSelection(
  process.env,
  join(CONVEX_DIR, ".env.local")
);
// No deployment yet means convex dev provisions a local one.
const ports = isLocalSelection(deployment)
  ? await resolveWorktree(ROOT)
  : undefined;
const child = Bun.spawn(
  [
    "bunx",
    "convex",
    "dev",
    ...localBackendArgs(ports),
    ...process.argv.slice(2),
  ],
  { cwd: CONVEX_DIR, stdio: ["inherit", "inherit", "inherit"] }
);
process.exitCode = await child.exited;
