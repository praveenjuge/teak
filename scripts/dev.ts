#!/usr/bin/env bun
/**
 * Single entrypoint for local dev.
 *
 *   bun run dev                  # the web stack, seeded, on this checkout's ports
 *   bun run dev --stop           # stop this checkout's web stack
 *   bun run dev --status         # this checkout's ports, URLs and sign-in
 *   bun run dev --workos staging # sign in through WorkOS staging instead
 *   bun run dev mobile           # another surface (Turbo)
 *   bun run dev --all            # every surface (Turbo)
 *   bun run dev --check          # print what would run
 *
 * The web stack runs setup, then the local WorkOS emulator, a local Convex
 * backend and the web app, and signs in as a seeded dev account. Every
 * worktree gets its own ports (scripts/worktree-env.ts), so several run at
 * once. Other surfaces run through `turbo watch`; `--headless` streams their
 * output for agents and CI.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_USER,
  isProcessAlive,
  readStackState,
  type StackState,
  stopOrphanedStack,
} from "../packages/tests/src/stack/config.ts";
import { readConvexSelection } from "./capabilities.ts";
import type { SetupReport } from "./setup.ts";
import {
  isLocalSelection,
  WORKOS_MODES,
  type WorkosMode,
} from "./setup-mode.ts";
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
  "Usage: bun run dev [target] [--workos emulator|staging] [--status] [--stop] [--all] [--check] [--headless]";

export const describeTargets = (): string =>
  [
    "Available dev targets:",
    "  web (default) — the local stack: WorkOS emulator, Convex and Next.js, seeded",
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
  target: string;
  workos: WorkosMode | null;
}

export const parseDevArgs = (argv: string[]): DevArgs => {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      action: "help",
      all: false,
      headless: false,
      target: "web",
      workos: null,
    };
  }
  const at = argv.indexOf("--workos");
  const value = at === -1 ? undefined : argv[at + 1];
  if (
    at !== -1 &&
    !(value && (WORKOS_MODES as readonly string[]).includes(value))
  ) {
    throw new Error(
      `Unknown --workos "${value ?? ""}" (expected emulator, staging)`
    );
  }
  const workos = (value as WorkosMode | undefined) ?? null;
  const rest =
    at === -1 ? argv : argv.filter((_, i) => i !== at && i !== at + 1);
  const flags = new Set([
    "--all",
    "--check",
    "--headless",
    "--status",
    "--stop",
  ]);
  const isTarget = (arg: string) =>
    Boolean(DEV_TARGETS[arg]) ||
    FILES_TARGETS.has(arg) ||
    Boolean(TARGET_ALIASES[arg]);
  const targets = rest.filter(isTarget);
  if (
    !rest.every((arg) => flags.has(arg) || isTarget(arg)) ||
    targets.length > 1
  ) {
    throw new Error(`Unknown dev target. ${describeTargets()}`);
  }
  const all = rest.includes("--all");
  const target = resolveTarget(targets[0] ?? "web");
  if (workos && (all || target !== "web")) {
    throw new Error("--workos applies only to the web stack");
  }
  let action: DevArgs["action"] = "run";
  if (rest.includes("--stop")) {
    action = "stop";
  } else if (rest.includes("--status")) {
    action = "status";
  } else if (rest.includes("--check")) {
    action = "check";
  }
  return { action, all, headless: rest.includes("--headless"), target, workos };
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
  return state && isProcessAlive(state.pid) ? state : null;
};

// A stack whose owner was killed outright leaves its backend and web server
// running; stop them before anything else looks at this checkout's stack.
const stopOrphans = async () => {
  if (await stopOrphanedStack()) {
    console.log("Stopped a stack left behind by a process that exited.");
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

/** What an agent needs to know about this checkout's stack, in a few lines. */
export const describeStatus = (
  ports: WorktreePorts,
  running: StackState | null
): string =>
  [
    `Teak local stack for this checkout (${ports.namespace}):`,
    running
      ? `  ${running.ready ? "Running" : "Starting"} at ${running.urls.appOrigin} (pid ${running.pid}). Stop it with \`bun run dev --stop\`.`
      : "  Not running. Start it with `bun run dev` (run it in the background; it stays up until stopped).",
    `  Ports: web ${ports.web}, Convex ${ports.convex} (HTTP ${ports.convexSite}), WorkOS emulator ${ports.emulator}, docs ${ports.docs}, extension ${ports.extension}.`,
    `  Sign in on the emulator's page as ${DEV_USER.email} / ${DEV_USER.password}; the account is seeded with sample cards.`,
    "  A running stack records its URLs in .agents/.state/stack.json and logs to .agents/.state/stack.log.",
  ].join("\n");

/**
 * This checkout's ports for the surfaces Turbo runs, and the local backend
 * for the docs proxy. Each app's turbo.json passes its variables through.
 */
const surfaceEnv = async (): Promise<Record<string, string>> => {
  const ports = await resolveWorktree(ROOT);
  const { deployment } = readConvexSelection(
    process.env,
    join(ROOT, "packages/convex/.env.local")
  );
  return {
    PORT: String(ports.web),
    DOCS_PORT: String(ports.docs),
    EXTENSION_PORT: String(ports.extension),
    ...(deployment &&
    isLocalSelection(deployment) &&
    !process.env.TEAK_DEV_API_URL
      ? { TEAK_DEV_API_URL: `http://127.0.0.1:${ports.convexSite}` }
      : {}),
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

const runWebStack = async (
  workosChoice: WorkosMode | null
): Promise<number> => {
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
  // already looked for them keeps failing to import them. The stack's watcher
  // pushes the backend, so setup skips its own push.
  const setup = Bun.spawn(
    [
      "bun",
      "--no-env-file",
      join(ROOT, "scripts/setup.ts"),
      "--target",
      "web",
      "--json",
      "--skip-push",
      ...(workosChoice ? ["--workos", workosChoice] : []),
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
  if (!report.ok) {
    for (const check of report.checks.filter((entry) => !entry.ok)) {
      console.error(`✗ ${check.id}: ${check.detail ?? ""}`);
      for (const line of check.remediation ?? []) {
        console.error(`    → ${line}`);
      }
    }
    return 1;
  }
  const ports = report.worktree;
  if (!ports) {
    return 1;
  }
  const emulator = report.workos === "emulator";
  const { deployment } = readConvexSelection(
    process.env,
    join(ROOT, "packages/convex/.env.local")
  );
  console.log("Starting the stack…");
  // Loaded after setup, which installs the packages the stack imports.
  const { STACK_LOG_PATH, startStack } = await import(
    "../packages/tests/src/stack/stack.ts"
  );
  let stack: Awaited<ReturnType<typeof startStack>>;
  try {
    stack = await startStack({
      echo: true,
      emulator,
      localBackend: isLocalSelection(deployment),
      ports,
      seed: emulator,
      watch: true,
    });
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
      `  Web       ${stack.urls.appOrigin}`,
      ...(emulator
        ? [
            `  Convex    ${stack.urls.convexUrl}`,
            `  WorkOS    ${stack.urls.emulatorOrigin} (local emulator)`,
            `  Sign in   ${DEV_USER.email} / ${DEV_USER.password}`,
          ]
        : ["  WorkOS    staging"]),
      `  Logs      ${STACK_LOG_PATH.replace(`${ROOT}/`, "")}`,
      "Stop with Ctrl-C or `bun run dev --stop`.",
      "",
    ].join("\n")
  );
  await stack.exited;
  await stack.stop();
  console.error(`The stack exited. See ${STACK_LOG_PATH}.`);
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
        `Would run setup (WorkOS: ${parsed.workos ?? "emulator unless this checkout uses staging"}), then the local stack on this checkout's ports`
      );
      return;
    }
    process.exitCode = await runWebStack(parsed.workos);
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
