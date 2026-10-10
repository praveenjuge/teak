#!/usr/bin/env bun
/**
 * Runs the E2E suite against this checkout's local stack: the WorkOS
 * emulator, a local Convex backend and the web app. Used the same way locally,
 * in any worktree, and in CI.
 *
 *   bun run --cwd packages/tests e2e [playwright args]   # set up, run, tear down
 *   bun run --cwd packages/tests e2e:stack               # keep the stack up
 *
 * With the stack up, run `bunx playwright test` in packages/tests directly.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolveWorktree } from "../../../../scripts/worktree-env.ts";
import { isStackRunning, readStackState } from "../stack/config";
import { STACK_LOG_PATH, startStack } from "../stack/stack";

const ROOT = join(import.meta.dir, "../../../..");
const TESTS = join(import.meta.dir, "../..");
const stackOnly = process.argv[2] === "stack";
// Without arguments, run the gating suites: the journeys and the browser
// matrix. The web specs run on demand: `bun run e2e --project=web`.
const playwrightArgs =
  process.argv.length > 2 && !stackOnly
    ? process.argv.slice(2)
    : ["--project=journey-*", "--project=matrix-*"];

const run = (command: string[], cwd: string) =>
  new Promise<number>((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });

const running = readStackState();
if (running && isStackRunning(running)) {
  throw new Error(
    "This checkout's stack is running. Stop it with `bun run dev --stop`, then re-run."
  );
}

// The stack pushes the backend once itself, so setup skips its push. Setup
// takes packages/convex/.env.local over for the local backend; the next
// `bun run dev` selects the shared dev deployment again.
if (
  (await run(
    ["bun", "run", "setup", "--target", "e2e", "--skip-push"],
    ROOT
  )) !== 0
) {
  throw new Error("bun run setup --target e2e failed");
}

// The suite makes its own accounts. The stack pushes once: the suite's trace
// and state writes would keep a watcher busy.
const stack = await startStack({
  echo: false,
  ports: await resolveWorktree(ROOT),
});

let exitCode = 1;

try {
  console.log(
    `E2E stack is up: web ${stack.urls.appOrigin}, API ${stack.urls.apiOrigin}, WorkOS emulator ${stack.urls.emulatorOrigin}. Logs: ${STACK_LOG_PATH}`
  );
  if (stackOnly) {
    await stack.exited;
  } else {
    exitCode = await run(
      ["bunx", "playwright", "test", ...playwrightArgs],
      TESTS
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`See ${STACK_LOG_PATH} for the stack output.`);
} finally {
  await stack.stop();
}
process.exit(exitCode);
