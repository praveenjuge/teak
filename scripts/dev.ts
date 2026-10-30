#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_DEPLOYMENT, DEV_DEPLOYMENT_URLS } from "./dev-deployment.ts";
import {
  isProcessAlive,
  isStackRunning,
  readStackState,
  type StackState,
  stopOrphanedStack,
} from "./lib/stack-state.ts";
import { resolveSetupConvex, runSetup, type SetupReport } from "./setup.ts";
import { resolveWorktree, type WorktreePorts } from "./worktree-env.ts";

/**
 * `bun run dev` starts here. This module imports no installed packages, so it
 * can install them and set up the checkout before it replaces itself with
 * scripts/dev-main.ts, which imports the packages that run the app.
 */

const ROOT = join(import.meta.dir, "..");
const DEV_MAIN = join(ROOT, "scripts/dev-main.ts");
const LOCAL_STACK = join(ROOT, "packages/tests/src/scripts/run-local-suite.ts");

export const DEV_TARGETS: Record<string, string[]> = {
  web: ["@teak/web", "@teak/convex"],
  convex: ["@teak/convex"],
  docs: ["@teak/docs"],
  extension: ["@teak/extension", "@teak/convex"],
  cli: ["teak-cli"],
  raycast: ["./apps/raycast"],
};

export const CORE_TARGETS = new Set(["core", "core:local"]);

export const TARGET_ALIASES: Record<string, string> = {
  "core-worker": "core",
};

const resolveTarget = (target: string): string =>
  TARGET_ALIASES[target] ?? target;

export const DEV_USAGE =
  "Usage: bun run dev [target] [--push] [--local] [--detach] [--status] [--stop] [--all] [--check] [--headless]";

export const describeTargets = (): string =>
  [
    "Available dev targets:",
    "  web (default) — Next.js on the shared cloud dev deployment, seeded",
    "  web --local — Next.js on a local backend, WorkOS emulator and Core Worker, seeded",
    "  convex — Convex backend only",
    "  docs — Docs site",
    "  extension — Chrome extension + Convex",
    "  cli — CLI",
    "  raycast — Raycast extension",
    "  core — core-worker (development config, remote dev bindings)",
    "  core:local — core-worker (isolated Miniflare)",
    "  --all — every surface",
  ].join("\n");

export interface DevArgs {
  action: "run" | "help" | "check" | "status" | "stop";
  all: boolean;
  /**
   * Start the web stack in its own session and return once it is ready, so
   * it outlives the shell that started it (agent tools stop background
   * commands after a while).
   */
  detach: boolean;
  headless: boolean;
  /**
   * Run the web stack on a local backend, the WorkOS emulator and the Files
   * Worker in Miniflare (the E2E suite's stack, pushing the backend as it
   * changes) instead of the shared dev deployment.
   */
  local: boolean;
  push: boolean;
  target: string;
}

export const parseDevArgs = (argv: string[]): DevArgs => {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      action: "help",
      all: false,
      detach: false,
      headless: false,
      local: false,
      push: false,
      target: "web",
    };
  }
  const flags = new Set([
    "--all",
    "--check",
    "--detach",
    "--headless",
    "--local",
    "--push",
    "--status",
    "--stop",
  ]);
  const isTarget = (arg: string) =>
    Boolean(DEV_TARGETS[arg]) ||
    CORE_TARGETS.has(arg) ||
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
  const detach = argv.includes("--detach");
  if (detach && (all || target !== "web")) {
    throw new Error("--detach applies only to the web stack");
  }
  const local = argv.includes("--local");
  if (local && (all || target !== "web" || push)) {
    throw new Error(
      "--local applies only to the web stack, and has no shared backend to --push to"
    );
  }
  let action: DevArgs["action"] = "run";
  if (argv.includes("--stop")) {
    action = "stop";
  } else if (argv.includes("--status")) {
    action = "status";
  } else if (argv.includes("--check")) {
    action = "check";
  }
  return {
    action,
    all,
    detach,
    headless: argv.includes("--headless"),
    local,
    push,
    target,
  };
};

export const usesWebStack = (args: DevArgs): boolean =>
  args.target === "web" && !args.all;

export const needsWebEnv = (target: string, all = false): boolean => {
  if (all) {
    return true;
  }
  return (DEV_TARGETS[target] ?? []).includes("@teak/web");
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
  if (target === "core") {
    return ["bun", "run", "--filter", "@teak/core-worker", "dev"];
  }
  if (target === "core:local") {
    return ["bun", "run", "--filter", "@teak/core-worker", "dev:local"];
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
  const state = readStackState(ROOT);
  return state && isStackRunning(state) ? state : null;
};

const stopOrphans = async () => {
  if (await stopOrphanedStack(ROOT)) {
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
  await stopOrphanedStack(ROOT);
  console.log("Stopped this checkout's stack.");
  return 0;
};

// Recorded when the stack starts, so a second `--local --detach` and
// `--status` see it as local before its account is seeded.
const isLocalDevStack = (running: StackState | null): boolean =>
  running?.mode === "e2e" && running.local === true;

const describeRunning = (running: StackState): string[] => {
  if (running.mode === "e2e" && !isLocalDevStack(running)) {
    return [
      `  An E2E run is using this checkout's ports (pid ${running.pid}); it stops when the run ends.`,
    ];
  }
  return [
    `  ${running.ready ? "Running" : "Starting"} at ${running.urls.appOrigin} (pid ${running.pid}). Stop it with \`bun run dev --stop\`.`,
    ...(running.notes ?? []).map((note) => `  ${note}`),
  ];
};

export const describeStatus = (
  ports: WorktreePorts,
  running: StackState | null
): string =>
  [
    isLocalDevStack(running)
      ? `Teak dev stack for this checkout (${ports.namespace}), on a local backend (bun run dev --local):`
      : `Teak dev stack for this checkout (${ports.namespace}), on the shared dev deployment ${DEV_DEPLOYMENT}:`,
    ...(running
      ? describeRunning(running)
      : [
          "  Not running. Start it with `bun run dev --detach` (it returns once the app is ready and stays up until `bun run dev --stop`).",
        ]),
    `  Ports: web ${ports.web}, docs ${ports.docs}, extension ${ports.extension}. The backend is ${isLocalDevStack(running) ? running?.urls.convexUrl : DEV_DEPLOYMENT_URLS.convexUrl}.`,
    "  A running stack records its URLs and sign-in in .agents/.state/stack.json and logs to .agents/.state/stack.log.",
  ].join("\n");

export type DevLaunch =
  | { kind: "check" | "help" | "status" | "stop" }
  | { install: boolean; kind: "detach" }
  | { detach: boolean; install: boolean; kind: "local" }
  | { install: boolean; kind: "main"; setup: boolean };

/**
 * What `bun run dev` does before scripts/dev-main.ts takes over: a run
 * installs packages on a fresh checkout, and the web stack runs setup first.
 * A detached web stack starts another `bun run dev` that does its own setup.
 */
export const planDevLaunch = (
  args: DevArgs,
  hasNodeModules: boolean
): DevLaunch => {
  if (args.action !== "run") {
    return { kind: args.action };
  }
  const install = !hasNodeModules;
  if (args.local) {
    return { detach: args.detach, install, kind: "local" };
  }
  if (usesWebStack(args) && args.detach) {
    return { install, kind: "detach" };
  }
  return { install, kind: "main", setup: usesWebStack(args) };
};

export const devMainCommand = (argv: string[]): string[] => [
  process.execPath,
  "--no-env-file",
  DEV_MAIN,
  ...argv,
];

const installPackages = (): number => {
  console.log("Installing packages…");
  const install = Bun.spawnSync(["bun", "ci"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return install.exitCode ?? 1;
};

const setUpWebStack = async (): Promise<boolean> => {
  await stopOrphans();
  const running = runningStack();
  if (running) {
    console.error(
      `This checkout's stack is already ${running.ready ? "running" : "starting"} at ${running.urls.appOrigin} (pid ${running.pid}). Stop it with \`bun run dev --stop\`.`
    );
    return false;
  }
  console.log("Setting up this checkout…");
  let report: SetupReport;
  try {
    report = await runSetup("web", resolveSetupConvex("web", null), false);
  } catch (error) {
    console.error(
      `✗ setup failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
  for (const check of report.checks.filter(
    (entry) => !entry.ok || entry.severity === "warn"
  )) {
    console.error(`${check.ok ? "~" : "✗"} ${check.id}: ${check.detail ?? ""}`);
    for (const line of check.remediation ?? []) {
      console.error(`    → ${line}`);
    }
  }
  return report.ok;
};

const DETACHED_LOG = join(ROOT, ".agents/.state/dev-detached.log");
const DETACH_READY_TIMEOUT_MS = 300_000;

export const localStackCommand = (): string[] => [
  process.execPath,
  "--no-env-file",
  LOCAL_STACK,
  "stack",
  "--dev",
];

const runDetached = async (push: boolean, local = false): Promise<number> => {
  await stopOrphans();
  const logPath = DETACHED_LOG.replace(`${ROOT}/`, "");
  let exitCode: number | null = null;
  const running = runningStack();
  if (running) {
    if (local ? !isLocalDevStack(running) : running.mode !== "dev") {
      console.log(describeStatus(await resolveWorktree(ROOT), running));
      console.error(
        `Another stack is using this checkout's ports; stop it with \`bun run dev --stop\` first.`
      );
      return 1;
    }
    if (push && running.pushing === false) {
      console.error(
        "This checkout's stack is already running without pushing the backend; stop it with `bun run dev --stop` and start it again with `--push` to take over."
      );
    }
  } else {
    mkdirSync(join(ROOT, ".agents/.state"), { recursive: true });
    const log = openSync(DETACHED_LOG, "w");
    const [command = process.execPath, ...commandArgs] = local
      ? localStackCommand()
      : [
          process.execPath,
          "--no-env-file",
          join(ROOT, "scripts/dev.ts"),
          ...(push ? ["--push"] : []),
        ];
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.on("exit", (code) => {
      exitCode = code ?? 1;
    });
    child.unref();
    console.log(
      `Starting the ${local ? "local " : ""}web stack in the background (pid ${child.pid}); its output goes to ${logPath}…`
    );
  }
  const deadline = Date.now() + DETACH_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      const output = readFileSync(DETACHED_LOG, "utf-8").trim();
      console.error(
        `✗ The stack exited (code ${exitCode}) before it was ready:\n${output.split("\n").slice(-20).join("\n")}`
      );
      return 1;
    }
    const state = runningStack();
    if (state?.ready) {
      console.log(describeStatus(await resolveWorktree(ROOT), state));
      return 0;
    }
    if (running && !state) {
      console.error(
        "✗ The stack that was starting exited before it was ready. See .agents/.state/stack.log."
      );
      return 1;
    }
    await Bun.sleep(1000);
  }
  console.error(
    `✗ The stack wasn't ready after ${DETACH_READY_TIMEOUT_MS / 1000}s; it is still starting. Check \`bun run dev --status\` and ${logPath}.`
  );
  return 1;
};

const describeCheck = (args: DevArgs): string => {
  if (args.local) {
    return `Would run the web app on a local backend, the WorkOS emulator and the Core Worker in Miniflare, with a seeded account${args.detach ? ", in the background" : ""}`;
  }
  if (usesWebStack(args)) {
    return `Would run setup, then the web app on this checkout's port against ${DEV_DEPLOYMENT}${args.push ? ", taking over pushing the backend" : ""}${args.detach ? ", in the background" : ""}`;
  }
  const command = buildDevCommand(args.target, {
    all: args.all,
    headless: args.headless,
  });
  return `Would run${args.headless ? " (headless, TURBO_UI=false)" : ""}: ${command.join(" ")}`;
};

const main = async (argv: string[]): Promise<number> => {
  let args: DevArgs;
  try {
    args = parseDevArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const launch = planDevLaunch(args, existsSync(join(ROOT, "node_modules")));
  switch (launch.kind) {
    case "help":
      console.log(`${DEV_USAGE}\n\n${describeTargets()}`);
      return 0;
    case "stop":
      return await stopStack();
    case "status":
      await stopOrphans();
      console.log(describeStatus(await resolveWorktree(ROOT), runningStack()));
      return 0;
    case "check":
      console.log(describeCheck(args));
      return 0;
    default:
      break;
  }
  if (launch.install) {
    const installed = installPackages();
    if (installed !== 0) {
      return installed;
    }
  }
  if (launch.kind === "detach") {
    return await runDetached(args.push);
  }
  if (launch.kind === "local") {
    if (launch.detach) {
      return await runDetached(false, true);
    }
    await stopOrphans();
    const running = runningStack();
    if (running) {
      console.log(describeStatus(await resolveWorktree(ROOT), running));
      return 1;
    }
    const [command = process.execPath, ...commandArgs] = localStackCommand();
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: "inherit" });
    return await new Promise<number>((resolve) =>
      child.once("exit", (code) => resolve(code ?? 1))
    );
  }
  if (launch.setup && !(await setUpWebStack())) {
    return 1;
  }
  if (!process.execve) {
    console.error(
      "bun run dev needs process.execve, which this platform lacks."
    );
    return 1;
  }
  return process.execve(process.execPath, devMainCommand(argv));
};

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
