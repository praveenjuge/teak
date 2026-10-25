#!/usr/bin/env bun
// Claude Code PostToolUse hook (.claude/settings.json): formats the file an
// Edit or Write just changed with the repository's Biome config, so the
// pre-commit check doesn't stop on formatting. Formatting only, about 150 ms:
// `biome check` (lint fixes) scans the whole project first and takes seconds,
// so `bun run fix` and the pre-commit hook keep that. Runs before the agent's
// next step, so it never races a later edit. Never fails the tool call.
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "../..");
const biome = join(root, "node_modules/.bin/biome");

try {
  const input = (await Bun.stdin.json()) as {
    tool_input?: { file_path?: unknown };
  };
  const file = input.tool_input?.file_path;
  const inside =
    typeof file === "string" &&
    !relative(root, file).startsWith("..") &&
    !relative(root, file).includes("node_modules");
  if (inside && existsSync(file) && existsSync(biome)) {
    Bun.spawnSync(
      [
        biome,
        "format",
        "--write",
        "--no-errors-on-unmatched",
        "--files-ignore-unknown=true",
        file,
      ],
      { cwd: root, stderr: "ignore", stdout: "ignore", timeout: 15_000 }
    );
  }
} catch {
  // A malformed payload or a missing Biome leaves the file as it was.
}
