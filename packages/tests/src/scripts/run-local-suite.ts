#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isStackRunning,
  readStackState,
  type StackUrls,
} from "../../../../scripts/lib/stack-state.ts";
import { prepareCheckout } from "../../../../scripts/setup.ts";
import { resolveWorktree } from "../../../../scripts/worktree-env.ts";
import { localBackendEnv, setupBackend } from "../stack/backend";
import { seedLocalDevAccount } from "../stack/devAccount";
import { type RunningStack, STACK_LOG_PATH, startStack } from "../stack/stack";

const ROOT = join(import.meta.dir, "../../../..");
const TESTS = join(import.meta.dir, "../..");
const stackOnly = process.argv[2] === "stack";
// `stack --dev` is `bun run dev --local`: the same stack, pushing the backend
// as it changes, with a seeded account to sign in with.
const devStack = stackOnly && process.argv[3] === "--dev";
// `bun run e2e -- --grep x` may pass the separator through.
const e2eArgs = stackOnly
  ? []
  : process.argv.slice(2).filter((arg, index) => index > 0 || arg !== "--");

const env = localBackendEnv();

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
      env: { ...env, E2E_TELEMETRY_DISABLED: "1" },
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
for (const line of await setupBackend(ROOT, ports, env)) {
  console.log(`✓ e2e-backend: ${line}`);
}

const startOptions = {
  echo: false,
  env,
  ports,
  ...(devStack
    ? {
        beforeReady: (urls: StackUrls) =>
          seedLocalDevAccount(urls, ports.namespace, env),
        watch: true,
      }
    : {}),
};

// Without --once, `convex dev` first downloads its local dashboard, and that
// download sometimes crashes the CLI behind a cloud session's HTTPS proxy
// (an assertion in its HTTP parser). A finished download is cached, so the
// next attempt gets past it.
const dashboardDownloadCrashed = () => {
  const log = existsSync(STACK_LOG_PATH)
    ? readFileSync(STACK_LOG_PATH, "utf-8")
    : "";
  return (
    log.includes("Downloading Convex dashboard") &&
    log.includes("ERR_ASSERTION")
  );
};

const startWithRetries = async (attempt = 1): Promise<RunningStack> => {
  try {
    return await startStack(startOptions);
  } catch (error) {
    if (!devStack || attempt >= 3 || !dashboardDownloadCrashed()) {
      throw error;
    }
    console.log(
      "The Convex CLI crashed downloading its dashboard; starting again."
    );
    return startWithRetries(attempt + 1);
  }
};

const stack = await startWithRetries();

let exitCode = 1;

try {
  console.log(
    `${devStack ? "Local dev" : "E2E"} stack is up: web ${stack.urls.appOrigin}, API ${stack.urls.apiOrigin}, WorkOS emulator ${stack.urls.emulatorOrigin}. Logs: ${STACK_LOG_PATH}`
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
