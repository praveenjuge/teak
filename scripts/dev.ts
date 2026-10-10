#!/usr/bin/env bun
/**
 * Single entrypoint for local dev.
 *
 *   bun run dev           # the web stack on this checkout's ports
 *   bun run dev --push    # also take over pushing the backend
 *   bun run dev --stop    # stop this checkout's web stack
 *   bun run dev --status  # this checkout's ports, URLs and sign-in
 *   bun run dev mobile    # another surface (Turbo)
 *   bun run dev --all     # every surface (Turbo)
 *   bun run dev --check   # print what would run
 *
 * The web stack runs setup, then the web app against the shared cloud dev
 * deployment (scripts/dev-stack.ts), signed in through WorkOS staging as this
 * checkout's seeded account. The checkout holding the push lease also pushes
 * its backend. Every worktree gets its own web ports
 * (scripts/worktree-env.ts), so several run at once. Other surfaces run
 * through `turbo watch`; `--headless` streams their output for agents and CI.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isProcessAlive,
  isStackRunning,
  readStackState,
  type StackState,
  stopOrphanedStack,
} from "../packages/tests/src/stack/config.ts";
import { DEV_DEPLOYMENT, DEV_DEPLOYMENT_URLS } from "./dev-deployment.ts";
import type { SetupReport } from "./setup.ts";
import { resolveWorktree, type WorktreePorts } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");

export const DEV_TARGETS: Record<string, string[]> = {
  web: ["@teak/web", "@teak/convex"],
  convex: ["@teak/convex"],
  docs: ["@teak/docs"],
  mobile: ["@teak/mobile"],
  extension: ["@teak/extension", "@teak/convex"],
  cli: ["teak-cli"],
  raycast: ["./apps/raycast"],
};

export const FILES_TARGETS = new Set(["files", "files:local"]);

/** Matrix names that resolve to a dev target. */
export const TARGET_ALIASES: Record<string, string> = {
  "files-worker": "files",
  "mobile-device": "mobile",
  "mobile-simulator": "mobile",
};

const resolveTarget = (target: string): string =>
  TARGET_ALIASES[target] ?? target;

export const DEV_USAGE =
  "Usage: bun run dev [target] [--push] [--status] [--stop] [--all] [--check] [--headless]";

export const describeTargets = (): string =>
  [
    "Available dev targets:",
    "  web (default) — Next.js on the shared cloud dev deployment, seeded",
    "  convex — Convex backend only",
    "  docs — Docs site",
    "  mobile — Expo mobile",
    "  extension — Chrome extension + Convex",
    "  cli — CLI",
    "  raycast — Raycast extension",
    "  files — files-worker (remote bindings)",
    "  files:local — files-worker (isolated Miniflare)",
    "  --all — every surface",
  ].join("\n");

export interface DevArgs {
  action: "run" | "help" | "check" | "status" | "stop";
  all: boolean;
  headless: boolean;
  /** Take over pushing the backend from whichever checkout holds the lease. */
  push: boolean;
  target: string;
}

export const parseDevArgs = (argv: string[]): DevArgs => {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      action: "help",
      all: false,
      headless: false,
      push: false,
      target: "web",
    };
  }
  const flags = new Set([
    "--all",
    "--check",
    "--headless",
    "--push",
    "--status",
    "--stop",
  ]);
  const isTarget = (arg: string) =>
    Boolean(DEV_TARGETS[arg]) ||
    FILES_TARGETS.has(arg) ||
    Boolean(TARGET_ALIASES[arg]);
  const targets = argv.filter(isTarget);
  if (
    !argv.every((arg) => flags.has(arg) || isTarget(arg)) ||
    targets.length > 1
  ) {
    throw new Error(`Unknown dev target. ${describeTargets()}`);
  }
  const all = argv.includes("--all");
  const target = resolveTarget(targets[0] ?? "web");
  const push = argv.includes("--push");
  if (push && (all || target !== "web")) {
    throw new Error("--push applies only to the web stack");
  }
  let action: DevArgs["action"] = "run";
  if (argv.includes("--stop")) {
    action = "stop";
  } else if (argv.includes("--status")) {
    action = "status";
  } else if (argv.includes("--check")) {
    action = "check";
  }
  return { action, all, headless: argv.includes("--headless"), push, target };
};

/** The web stack runs on its own; everything else goes through Turbo. */
export const usesWebStack = (args: DevArgs): boolean =>
  args.target === "web" && !args.all;

export const needsWebEnv = (target: string, all = false): boolean => {
  if (all) {
    return true;
  }
  return (DEV_TARGETS[target] ?? []).includes("@teak/web");
};

// Loaded on demand: the validator reads the web app's config, which needs
// installed packages, and the web stack runs setup before anything else.
const webEnvValid = async (): Promise<boolean> => {
  const path = join(ROOT, "apps/web/.env.local");
  if (!existsSync(path)) {
    return false;
  }
  const { validateWebEnvContent } = await import("./validate-env.ts");
  return validateWebEnvContent(readFileSync(path, "utf-8")).length === 0;
};

export const buildDevCommand = (
  target: string,
  opts?: { all?: boolean; headless?: boolean }
): string[] => {
  // Dev tasks are persistent but never interactive (no stdin), so stream
  // mode runs the same servers headlessly for agents and CI. Turbo's `auto`
  // log order groups output on GitHub Actions, which holds persistent task
  // logs until exit, so headless output pins `stream`.
  const ui = opts?.headless
    ? ["--ui=stream", "--log-order=stream"]
    : ["--ui=tui"];
  if (opts?.all) {
    return ["turbo", "watch", "dev", ...ui];
  }
  if (target === "files") {
    return ["bun", "run", "--filter", "@teak/files-worker", "dev"];
  }
  if (target === "files:local") {
    return ["bun", "run", "--filter", "@teak/files-worker", "dev:local"];
  }
  const filters = DEV_TARGETS[target] ?? DEV_TARGETS.web ?? [];
  return [
    "turbo",
    "watch",
    "dev",
    ...ui,
    ...filters.flatMap((filter) => ["--filter", filter]),
  ];
};

const runningStack = (): StackState | null => {
  const state = readStackState();
  return state && isStackRunning(state) ? state : null;
};

// A stack whose owner was killed outright leaves its backend and web server
// running; stop them before anything else looks at this checkout's stack.
const stopOrphans = async () => {
  if (await stopOrphanedStack()) {
    console.log("Cleaned up a stack left behind by a process that exited.");
  }
};

const stopStack = async (): Promise<number> => {
  await stopOrphans();
  const state = runningStack();
  if (!state) {
    console.log("No stack is running for this checkout.");
    return 0;
  }
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + 30_000;
  while (isProcessAlive(state.pid) && Date.now() < deadline) {
    await Bun.sleep(200);
  }
  if (isProcessAlive(state.pid)) {
    console.error(`The stack (pid ${state.pid}) did not stop within 30s.`);
    return 1;
  }
  console.log("Stopped this checkout's stack.");
  return 0;
};

const describeRunning = (running: StackState): string[] => {
  if (running.mode === "e2e") {
    return [
      `  The E2E stack is ${running.ready ? "running" : "starting"} at ${running.urls.appOrigin} (pid ${running.pid}), on a local backend and the WorkOS emulator.`,
    ];
  }
  return [
    `  ${running.ready ? "Running" : "Starting"} at ${running.urls.appOrigin} (pid ${running.pid}). Stop it with \`bun run dev --stop\`.`,
    ...(running.notes ?? []).map((note) => `  ${note}`),
  ];
};

/** What an agent needs to know about this checkout's stack, in a few lines. */
export const describeStatus = (
  ports: WorktreePorts,
  running: StackState | null
): string =>
  [
    `Teak dev stack for this checkout (${ports.namespace}), on the shared dev deployment ${DEV_DEPLOYMENT}:`,
    ...(running
      ? describeRunning(running)
      : [
          "  Not running. Start it with `bun run dev` (run it in the background; it stays up until stopped).",
        ]),
    `  Ports: web ${ports.web}, docs ${ports.docs}, extension ${ports.extension}. The backend is ${DEV_DEPLOYMENT_URLS.convexUrl}.`,
    "  A running stack records its URLs and sign-in in .agents/.state/stack.json and logs to .agents/.state/stack.log.",
  ].join("\n");

/**
 * This checkout's ports for the surfaces Turbo runs, and the dev deployment's
 * API for the docs proxy. Each app's turbo.json passes its variables through.
 */
const surfaceEnv = async (): Promise<Record<string, string>> => {
  const ports = await resolveWorktree(ROOT);
  return {
    PORT: String(ports.web),
    DOCS_PORT: String(ports.docs),
    EXTENSION_PORT: String(ports.extension),
    TEAK_DEV_API_URL:
      process.env.TEAK_DEV_API_URL ?? DEV_DEPLOYMENT_URLS.convexSiteUrl,
  };
};

// A fresh checkout has no packages yet, and Bun remembers a missing
// node_modules for the rest of the process, so install and run again.
const installThenRestart = (): number => {
  console.log("Installing packages…");
  const install = Bun.spawnSync(["bun", "ci"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (install.exitCode !== 0) {
    return install.exitCode ?? 1;
  }
  const again = Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      join(ROOT, "scripts/dev.ts"),
      ...process.argv.slice(2),
    ],
    { cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit" }
  );
  return again.exitCode ?? 1;
};

const runWebStack = async (push: boolean): Promise<number> => {
  await stopOrphans();
  const running = runningStack();
  if (running) {
    console.error(
      `This checkout's stack is already ${running.ready ? "running" : "starting"} at ${running.urls.appOrigin} (pid ${running.pid}). Stop it with \`bun run dev --stop\`.`
    );
    return 1;
  }
  console.log("Setting up this checkout…");
  // Setup runs in its own process: when it installs packages, a process that
  // already looked for them keeps failing to import them.
  const setup = Bun.spawn(
    [
      "bun",
      "--no-env-file",
      join(ROOT, "scripts/setup.ts"),
      "--target",
      "web",
      "--json",
    ],
    { cwd: ROOT, stdout: "pipe", stderr: "inherit" }
  );
  const output = await new Response(setup.stdout).text();
  await setup.exited;
  let report: SetupReport;
  try {
    report = JSON.parse(output) as SetupReport;
  } catch {
    console.error(`Setup failed:\n${output}`);
    return 1;
  }
  for (const check of report.checks.filter(
    (entry) => !entry.ok || entry.severity === "warn"
  )) {
    console.error(`${check.ok ? "~" : "✗"} ${check.id}: ${check.detail ?? ""}`);
    for (const line of check.remediation ?? []) {
      console.error(`    → ${line}`);
    }
  }
  if (!report.ok) {
    return 1;
  }
  const ports = report.worktree;
  if (!ports) {
    return 1;
  }
  console.log("Starting the web app…");
  // Loaded after setup, which installs the packages the stack imports.
  const { DEV_LOG_PATH, startDevStack } = await import("./dev-stack.ts");
  let stack: Awaited<ReturnType<typeof startDevStack>>;
  try {
    stack = await startDevStack({ echo: true, ports, push });
  } catch (error) {
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
  console.log(
    [
      "",
      `Teak is running (${ports.namespace})`,
      `  Web       ${stack.state.urls.appOrigin}`,
      `  Convex    ${stack.state.urls.convexUrl} (shared dev deployment)`,
      ...stack.notes.map((note) => `  ${note}`),
      `  Logs      ${DEV_LOG_PATH.replace(`${ROOT}/`, "")}`,
      "Stop with Ctrl-C or `bun run dev --stop`.",
      "",
    ].join("\n")
  );
  await stack.exited;
  await stack.stop();
  console.error(`The stack exited. See ${DEV_LOG_PATH}.`);
  return 1;
};

const main = async (): Promise<void> => {
  let parsed: DevArgs;
  try {
    parsed = parseDevArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (parsed.action === "help") {
    console.log(DEV_USAGE);
    console.log("");
    console.log(describeTargets());
    return;
  }
  if (parsed.action === "stop") {
    process.exitCode = await stopStack();
    return;
  }
  if (parsed.action === "status") {
    await stopOrphans();
    console.log(describeStatus(await resolveWorktree(ROOT), runningStack()));
    return;
  }
  if (usesWebStack(parsed)) {
    if (parsed.action === "run" && !existsSync(join(ROOT, "node_modules"))) {
      process.exitCode = installThenRestart();
      return;
    }
    if (parsed.action === "check") {
      console.log(
        `Would run setup, then the web app on this checkout's port against ${DEV_DEPLOYMENT}${parsed.push ? ", taking over pushing the backend" : ""}`
      );
      return;
    }
    process.exitCode = await runWebStack(parsed.push);
    return;
  }
  // Fail fast before Turbo spawns watchers (skip for --check dry-runs).
  // Only the web stack needs apps/web/.env.local; extension uses its own
  // VITE_PUBLIC_CONVEX_* variables and must stay runnable without web env.
  if (
    parsed.action === "run" &&
    needsWebEnv(parsed.target, parsed.all) &&
    !(await webEnvValid())
  ) {
    console.error(
      "✗ apps/web/.env.local missing or invalid — run: bun run setup && bun run doctor."
    );
    process.exitCode = 1;
    return;
  }
  const command = buildDevCommand(parsed.target, {
    all: parsed.all,
    headless: parsed.headless,
  });
  if (parsed.action === "check") {
    console.log(
      `Would run${parsed.headless ? " (headless, TURBO_UI=false)" : ""}: ${command.join(" ")}`
    );
    return;
  }
  if (parsed.headless) {
    console.log("dev --headless: streaming output, no interactive input.");
  }
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: parsed.headless ? "ignore" : "inherit",
    env: {
      ...process.env,
      ...(await surfaceEnv()),
      ...(parsed.headless ? { TURBO_UI: "false" } : {}),
    },
  });
  process.exitCode = result.exitCode ?? 1;
};

if (import.meta.main) {
  await main();
}
