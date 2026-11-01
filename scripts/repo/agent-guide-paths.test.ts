import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

const ROOTED = /^(?:apps|packages|scripts|\.agents|\.claude|\.github)\//;
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
    ...trackedFiles(":(glob).agents/**/*.md").filter(
      (file) =>
        !file.startsWith(".agents/skills/") ||
        /^\.agents\/skills\/(?:teak-[^/]+|verify-teak)\/SKILL\.md$/.test(file)
    ),
    ...trackedFiles(":(glob)apps/docs/content/docs/(open-source)/*.mdx"),
  ].sort();

const reviewedGuides = (): string[] =>
  ["guides", "runbooks", "records"]
    .flatMap((folder) => trackedFiles(`:(glob).agents/${folder}/*.md`))
    .sort();

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

  test("finds the guides that record a review date", () => {
    expect(reviewedGuides().length).toBeGreaterThan(0);
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
