#!/usr/bin/env bun
/**
 * Runs the E2E suite against a local stack: the WorkOS emulator, a local
 * Convex backend and the web app. Used the same way locally and in CI.
 *
 *   bun run --cwd packages/tests e2e [playwright args]   # set up, run, tear down
 *   bun run --cwd packages/tests e2e:stack               # keep the stack up
 *
 * With the stack up, run `bunx playwright test` in packages/tests directly.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  EMULATOR_PORT,
  LOCAL_API_ORIGIN,
  LOCAL_APP_ORIGIN,
} from "../emulator/config";
import { startEmulator } from "../emulator/start";

const ROOT = join(import.meta.dir, "../../../..");
const TESTS = join(import.meta.dir, "../..");
// Playwright clears test-results on each run, so logs live with the state.
const LOG_DIR = join(TESTS, ".state");
const stackOnly = process.argv[2] === "stack";
// Without arguments, run every suite that needs the stack (not the docs).
const playwrightArgs =
  process.argv.length > 2 && !stackOnly
    ? process.argv.slice(2)
    : ["--project=journey-*", "--project=matrix-*"];

const portIsFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => server.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });

const run = (command: string[], cwd: string) =>
  new Promise<number>((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });

const waitFor = async (url: string, dev: ChildProcess, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dev.exitCode !== null) {
      throw new Error(`The dev stack exited before ${url} came up`);
    }
    try {
      // Only the stack's own fixed loopback URLs are polled.
      // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
      // The web app redirects to hosted sign-in, so follow redirects and
      // require the final page (or the API health check) to succeed.
      const response = await fetch(url);
      await response.body?.cancel();
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
};

const stopGroup = (child: ChildProcess) => {
  if (child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
};

for (const port of [EMULATOR_PORT, 3000, 3210, 3211]) {
  if (!(await portIsFree(port))) {
    throw new Error(
      `Port ${port} is in use. Stop the running stack first; the e2e stack needs ports 3000, 3210, 3211 and ${EMULATOR_PORT}.`
    );
  }
}

process.env.CONVEX_AGENT_MODE ||= "anonymous";
if ((await run(["bun", "run", "setup", "--target", "e2e"], ROOT)) !== 0) {
  throw new Error("bun run setup --target e2e failed");
}

const emulator = await startEmulator();
mkdirSync(LOG_DIR, { recursive: true });
const devLog = join(LOG_DIR, "dev-stack.log");
// Setup already pushed the backend. Watching would loop: the functions
// directory holds the anonymous backend's own state, which every push
// rewrites. `--once --start` keeps the backend up exactly as long as the web
// dev server runs, and `turbo watch` is avoided because the suite's trace and
// state writes overflow its watcher, which then restarts every task.
const dev = spawn(
  "bunx",
  [
    "convex",
    "dev",
    "--once",
    "--codegen",
    "disable",
    "--typecheck",
    "disable",
    "--start",
    "bun run --cwd ../../apps/web dev",
  ],
  {
    cwd: join(ROOT, "packages/convex"),
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }
);
const log = createWriteStream(devLog);
dev.stdout?.pipe(log);
dev.stderr?.pipe(log);

let exitCode = 1;
const teardown = async () => {
  stopGroup(dev);
  await emulator.close();
};
process.once("SIGINT", () => {
  teardown().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  teardown().finally(() => process.exit(143));
});

try {
  await waitFor(`${LOCAL_API_ORIGIN}/healthz`, dev, 180_000);
  await waitFor(LOCAL_APP_ORIGIN, dev, 180_000);
  console.log(
    `E2E stack is up: web ${LOCAL_APP_ORIGIN}, API ${LOCAL_API_ORIGIN}, WorkOS emulator ${emulator.url}. Dev logs: ${devLog}`
  );
  if (stackOnly) {
    await new Promise(() => undefined);
  }
  exitCode = await run(
    ["bunx", "playwright", "test", ...playwrightArgs],
    TESTS
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`See ${devLog} for the dev stack output.`);
} finally {
  await teardown();
}
process.exit(exitCode);
