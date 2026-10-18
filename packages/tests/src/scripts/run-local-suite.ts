#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  isStackRunning,
  readStackState,
} from "../../../../scripts/lib/stack-state.ts";
import { prepareCheckout } from "../../../../scripts/setup.ts";
import { resolveWorktree } from "../../../../scripts/worktree-env.ts";
import { setupBackend } from "../stack/backend";
import { STACK_LOG_PATH, startStack } from "../stack/stack";

const ROOT = join(import.meta.dir, "../../../..");
const TESTS = join(import.meta.dir, "../..");
const stackOnly = process.argv[2] === "stack";
// `bun run e2e -- --grep x` may pass the separator through.
const e2eArgs = stackOnly
  ? []
  : process.argv.slice(2).filter((arg, index) => index > 0 || arg !== "--");

const runs: string[][] =
  e2eArgs.length > 0
    ? [e2eArgs]
    : [
        ["--config", "e2e.config.ts"],
        ["--config", "e2e.webkit.config.ts"],
      ];

const e2e = (args: string[]) =>
  new Promise<number>((resolve) => {
    const child = spawn("bunx", ["e2e", "run", ...args], {
      cwd: TESTS,
      env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" },
      stdio: "inherit",
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });

const running = readStackState(ROOT);
if (running && isStackRunning(running)) {
  throw new Error(
    "This checkout's stack is running. Stop it with `bun run dev --stop`, then re-run."
  );
}

const prepared = await prepareCheckout(ROOT, false);
for (const check of prepared.checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.id}: ${check.detail ?? ""}`);
}
if (!prepared.ok) {
  throw new Error("The pinned runtimes or packages aren't ready; see above");
}
const ports = await resolveWorktree(ROOT);
for (const line of await setupBackend(ROOT, ports)) {
  console.log(`✓ e2e-backend: ${line}`);
}

const stack = await startStack({ echo: false, ports });

let exitCode = 1;

try {
  console.log(
    `E2E stack is up: web ${stack.urls.appOrigin}, API ${stack.urls.apiOrigin}, WorkOS emulator ${stack.urls.emulatorOrigin}. Logs: ${STACK_LOG_PATH}`
  );
  if (stackOnly) {
    await stack.exited;
  } else {
    exitCode = await e2e(["--config", "e2e.warmup.config.ts"]);
    if (exitCode === 0) {
      for (const args of runs) {
        const code = await e2e(args);
        exitCode ||= code;
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`See ${STACK_LOG_PATH} for the stack output.`);
} finally {
  await stack.stop();
}
process.exit(exitCode);
