import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Agent guides point at docs pages and source files instead of repeating
// them, so a moved or deleted file must not leave a guide pointing nowhere.
// A nested guide may name paths from its own workspace.

const ROOT = join(import.meta.dir, "../..");

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

// Root and nested AGENTS.md, Teak's own guides, runbooks and records in
// `.agents`, Teak's own skills, and the docs pages AGENTS.md sends agents to.
const guideFiles = (): string[] =>
  [
    ...trackedFiles("*AGENTS.md"),
    ...trackedFiles(":(glob).agents/**/*.md").filter(
      (file) =>
        !file.startsWith(".agents/skills/") ||
        /^\.agents\/skills\/(?:teak-[^/]+|verify-teak)\/SKILL\.md$/.test(file)
    ),
    ...trackedFiles(":(glob)apps/docs/content/docs/(open-source)/*.mdx"),
  ].sort();

// Guides that record Teak's own deployments must say when someone last
// checked them, so the weekly audit can find the stale ones.
const reviewedGuides = (): string[] =>
  trackedFiles(":(glob).agents/{guides,runbooks,records}/*.md");

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

  test.each(reviewedGuides())("%s says when it was last reviewed", (file) => {
    expect(readFileSync(join(ROOT, file), "utf-8")).toMatch(
      /^Last reviewed: \d{4}-\d{2}-\d{2}$/m
    );
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
