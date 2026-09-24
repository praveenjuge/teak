import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Sep 24, 2026: a workspace-scoped `bun add` in apps/docs committed a bun.lock
// whose hoisting a root install disagrees with. Every `bun install
// --frozen-lockfile` / `bun ci` on main then failed (Backend Deploy, Clean
// Container Smoke). The pre-commit hook now rejects an out-of-sync lockfile
// before it can be committed, and this test keeps the committed one in sync.
const ROOT = join(import.meta.dir, "..");
const FROZEN_CHECK = "bun install --frozen-lockfile --lockfile-only";

describe("lockfile sync", () => {
  test("pre-commit rejects an out-of-sync bun.lock", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts["pre-commit"]).toStartWith(FROZEN_CHECK);
    expect(pkg["simple-git-hooks"]["pre-commit"]).toBe("bun run pre-commit");
  });

  test("committed bun.lock matches package.json manifests", () => {
    const result = Bun.spawnSync(FROZEN_CHECK.split(" "), {
      cwd: ROOT,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.stderr.toString()).not.toContain("lockfile had changes");
    expect(result.exitCode).toBe(0);
  });
});
