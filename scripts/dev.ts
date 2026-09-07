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
  target: string;
} => {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { action: "help", all: false, target: "web" };
  }
  const all = argv.includes("--all");
  const check = argv.includes("--check");
  const target =
    argv.find(
      (arg) =>
        !arg.startsWith("-") && (DEV_TARGETS[arg] || FILES_TARGETS.has(arg))
    ) ?? "web";
  if (
    argv.some(
      (arg) =>
        !(arg.startsWith("-") || DEV_TARGETS[arg] || FILES_TARGETS.has(arg))
    )
  ) {
    throw new Error(`Unknown dev target. ${describeTargets()}`);
  }
  return { action: check ? "check" : "run", all, target };
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
    console.log("Usage: bun run dev [target] [--all] [--check]");
    console.log("");
    console.log(describeTargets());
    return;
  }
  // Fail fast on web targets before Turbo spawns watchers (skip for --check dry-runs).
  if (
    parsed.action === "run" &&
    (parsed.all || parsed.target === "web" || parsed.target === "extension") &&
    !webEnvValid()
  ) {
    console.error(
      "✗ apps/web/.env.local missing or invalid — run: bun run setup && bun run doctor"
    );
    process.exitCode = 1;
    return;
  }
  const command = buildDevCommand(parsed.target, { all: parsed.all });
  if (parsed.action === "check") {
    console.log(`Would run: ${command.join(" ")}`);
    return;
  }
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  process.exitCode = result.exitCode ?? 1;
};

if (import.meta.main) {
  main();
}
