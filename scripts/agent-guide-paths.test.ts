import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Agent guides point at docs pages and source files instead of repeating
// them, so a moved or deleted file must not leave a guide pointing nowhere.
// A nested guide may name paths from its own workspace.

const ROOT = join(import.meta.dir, "..");

const ROOTED = /^(?:apps|packages|scripts|\.agents|\.claude|\.github)\//;
// Placeholders, globs and files that only exist at runtime or after a build.
const UNCHECKED =
  /[*<>{}…]|\.\.\.|\.agents\/\.state\/|\/(?:\.output|\.e2e|node_modules|dist)(?:\/|$)|\.env|\.dev\.vars/;

const trackedFiles = (pattern: string): string[] => {
  const result = spawnSync("git", ["ls-files", pattern], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return result.stdout.split("\n").filter(Boolean);
};

const guideFiles = (): string[] =>
  [
    ...trackedFiles("*AGENTS.md"),
    ...trackedFiles(":(glob).agents/*.md"),
    ...trackedFiles(":(glob).claude/agents/*.md"),
  ].sort();

export const rootedPaths = (markdown: string): string[] =>
  [...markdown.matchAll(/`([^`\s]+)`/g)]
    .map((match) =>
      (match[1] ?? "").replace(/:\d[\d–-]*$/, "").replace(/[.,:;]+$/, "")
    )
    .filter((path) => ROOTED.test(path) && !UNCHECKED.test(path));

describe("agent guide paths", () => {
  test("finds rooted paths and skips placeholders", () => {
    expect(
      rootedPaths(
        "Read `apps/docs/AGENTS.md`, `.agents/plans/<file>.md`, `src/index.ts`, `packages/tests/.e2e/x` and `packages/sdk/dist`."
      )
    ).toEqual(["apps/docs/AGENTS.md"]);
  });

  test.each(guideFiles())("every repository path in %s exists", (file) => {
    const missing = rootedPaths(readFileSync(join(ROOT, file), "utf-8")).filter(
      (path) =>
        !(
          existsSync(join(ROOT, path)) ||
          existsSync(join(ROOT, dirname(file), path))
        )
    );
    expect(missing, `${file} points at missing paths`).toEqual([]);
  });
});
