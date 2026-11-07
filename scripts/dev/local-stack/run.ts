#!/usr/bin/env bun
// The local stack (a local Convex backend, the WorkOS emulator, the Core
// Worker under `wrangler dev` and the web app), started for this checkout.
// `bun run dev --local` runs it with `--dev` (watching, with a seeded dev
// account); packages/tests runs the e2e suite against it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { currentStack, type StackUrls } from "../../lib/stack-state.ts";
import { prepareCheckout } from "../../setup/setup.ts";
import { resolveWorktree } from "../worktree-env.ts";
import { localBackendEnv, setupBackend } from "./backend.ts";
import { seedLocalDevAccount } from "./devAccount.ts";
import { type RunningStack, STACK_LOG_PATH, startStack } from "./stack.ts";

const ROOT = join(import.meta.dir, "../../..");

export interface LocalStackOptions {
  /** Watch the backend and seed the dev account, for `bun run dev --local`. */
  dev?: boolean;
  /**
   * Runs once the stack is up, with the environment it runs under; the stack
   * stops when it settles and its result is the exit code. Without it, the
   * stack runs until it exits.
   */
  whileUp?: (env: NodeJS.ProcessEnv) => Promise<number>;
}

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

/** Starts the stack, runs `whileUp` or waits for it to exit, and stops it. */
export const runLocalStack = async ({
  dev = false,
  whileUp,
}: LocalStackOptions = {}): Promise<number> => {
  const env = localBackendEnv();
  const { phase } = currentStack(ROOT);
  if (phase === "ready" || phase === "starting") {
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
    ...(dev
      ? {
          beforeReady: (urls: StackUrls) =>
            seedLocalDevAccount(urls, ports.namespace, env),
          watch: true,
        }
      : {}),
  };
  const startWithRetries = async (attempt = 1): Promise<RunningStack> => {
    try {
      return await startStack(startOptions);
    } catch (error) {
      if (!dev || attempt >= 3 || !dashboardDownloadCrashed()) {
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
      `${dev ? "Local dev" : "E2E"} stack is up: web ${stack.urls.appOrigin}, API ${stack.urls.apiOrigin}, WorkOS emulator ${stack.urls.emulatorOrigin}. Logs: ${STACK_LOG_PATH}`
    );
    if (whileUp) {
      exitCode = await whileUp(env);
    } else {
      await stack.exited;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`See ${STACK_LOG_PATH} for the stack output.`);
  } finally {
    await stack.stop();
  }
  return exitCode;
};

if (import.meta.main) {
  process.exit(await runLocalStack({ dev: process.argv.includes("--dev") }));
}
