#!/usr/bin/env bun
/**
 * Single entrypoint for local dev stacks.
 *
 * Canonical usage:
 *   bun run dev              # web + Convex (default)
 *   bun run dev mobile       # single surface
 *   bun run dev --all        # every surface
 *   bun run dev --help       # list targets
 *   bun run dev --check web  # print the turbo command without running
 *   bun run dev web --headless  # non-interactive output for agents and CI
 *
 * Legacy `dev:*` package scripts remain as thin aliases for compatibility
 * (docs, editor tasks, and existing muscle memory). They all delegate here
 * so filter mapping lives in exactly one place.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateWebEnvContent } from "./validate-env.ts";

const ROOT = join(import.meta.dir, "..");

export const DEV_TARGETS: Record<string, string[]> = {
  web: ["@teak/web", "@teak/convex"],
  convex: ["@teak/convex"],
  docs: ["@teak/docs"],
  mobile: ["@teak/mobile"],
  desktop: ["@teak/desktop"],
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

export const describeTargets = (): string =>
  [
    "Available dev targets:",
    "  web (default) — Next.js + Convex",
    "  convex — Convex backend only",
    "  docs — Docs site",
    "  mobile — Expo mobile",
    "  desktop — Electron desktop",
    "  extension — Chrome extension + Convex",
    "  cli — CLI",
    "  raycast — Raycast extension",
    "  files — files-worker (remote bindings)",
    "  files:local — files-worker (isolated Miniflare)",
    "  --all — every surface",
  ].join("\n");

export const parseDevArgs = (
  argv: string[]
): {
  action: "run" | "help" | "check";
  all: boolean;
  headless: boolean;
  target: string;
} => {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { action: "help", all: false, headless: false, target: "web" };
  }
  const flags = new Set(["--all", "--check", "--headless"]);
  const known = (arg: string): boolean =>
    flags.has(arg) ||
    Boolean(DEV_TARGETS[arg]) ||
    FILES_TARGETS.has(arg) ||
    Boolean(TARGET_ALIASES[arg]);
  const targets = argv.filter(
    (arg) => DEV_TARGETS[arg] || FILES_TARGETS.has(arg) || TARGET_ALIASES[arg]
  );
  if (!argv.every(known) || targets.length > 1) {
    throw new Error(`Unknown dev target. ${describeTargets()}`);
  }
  const all = argv.includes("--all");
  const check = argv.includes("--check");
  const headless = argv.includes("--headless");
  const target = resolveTarget(targets[0] ?? "web");
  return { action: check ? "check" : "run", all, headless, target };
};

export const needsWebEnv = (target: string, all = false): boolean => {
  if (all) {
    return true;
  }
  return (DEV_TARGETS[target] ?? []).includes("@teak/web");
};

const webEnvValid = (): boolean => {
  const path = join(ROOT, "apps/web/.env.local");
  if (!existsSync(path)) {
    return false;
  }
  return validateWebEnvContent(readFileSync(path, "utf-8")).length === 0;
};

export const buildDevCommand = (
  target: string,
  opts?: { all?: boolean }
): string[] => {
  if (opts?.all) {
    return ["turbo", "watch", "dev", "--ui=tui"];
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
    "--ui=tui",
    ...filters.flatMap((filter) => ["--filter", filter]),
  ];
};

const main = (): void => {
  const args = process.argv.slice(2);
  let parsed: ReturnType<typeof parseDevArgs>;
  try {
    parsed = parseDevArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (parsed.action === "help") {
    console.log("Usage: bun run dev [target] [--all] [--check] [--headless]");
    console.log("");
    console.log(describeTargets());
    return;
  }
  // Fail fast before Turbo spawns watchers (skip for --check dry-runs).
  // Only the web stack needs apps/web/.env.local; extension uses its own
  // VITE_PUBLIC_CONVEX_* variables and must stay runnable without web env.
  if (
    parsed.action === "run" &&
    needsWebEnv(parsed.target, parsed.all) &&
    !webEnvValid()
  ) {
    console.error(
      "✗ apps/web/.env.local missing or invalid — run: bun run setup && bun run doctor. " +
        "If the file exists with missing/invalid keys, delete it and re-run setup, or edit it to set NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 and NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211."
    );
    process.exitCode = 1;
    return;
  }
  const command = buildDevCommand(parsed.target, { all: parsed.all });
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
    ...(parsed.headless ? { env: { ...process.env, TURBO_UI: "false" } } : {}),
  });
  process.exitCode = result.exitCode ?? 1;
};

if (import.meta.main) {
  main();
}
