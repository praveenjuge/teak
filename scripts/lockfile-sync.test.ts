import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSnapshotFile,
  pinnedBunVersion,
  runFrozenCheck,
  writeStagedSnapshot,
} from "./check-lockfile";

// Sep 24, 2026: a workspace-scoped `bun add` in apps/docs committed a bun.lock
// whose hoisting a root install disagrees with. Every `bun install
// --frozen-lockfile` / `bun ci` on main then failed (Backend Deploy, Clean
// Container Smoke). scripts/check-lockfile.ts now rejects that at pre-commit.
const ROOT = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

const withSnapshot = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-sync-test-"));
  try {
    writeStagedSnapshot(dir);
    fn(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

describe("lockfile sync", () => {
  test("pre-commit runs the lockfile guard first", () => {
    expect(pkg.scripts["pre-commit"]).toStartWith(
      "bun --no-env-file run scripts/check-lockfile.ts && "
    );
    expect(pkg["simple-git-hooks"]["pre-commit"]).toBe("bun run pre-commit");
  });

  test("guard runs under the Bun that CI pins", () => {
    expect(pinnedBunVersion(JSON.stringify(pkg))).toBe(Bun.version);
    expect(pinnedBunVersion('{"packageManager":"bun@1.4.2"}')).toBe("1.4.2");
    expect(pinnedBunVersion('{"packageManager":"npm@10.0.0"}')).toBeUndefined();
  });

  test("snapshot covers every install input", () => {
    expect(isSnapshotFile("package.json")).toBe(true);
    expect(isSnapshotFile("apps/docs/package.json")).toBe(true);
    expect(isSnapshotFile("bun.lock")).toBe(true);
    expect(isSnapshotFile("bunfig.toml")).toBe(true);
    expect(isSnapshotFile("apps/docs/bun.lock.md")).toBe(false);
  });

  test("committed bun.lock matches the manifests", () => {
    withSnapshot((dir) => {
      const result = runFrozenCheck(dir);
      expect(result.output).not.toContain("lockfile had changes");
      expect(result.ok).toBe(true);
    });
  });

  test("a lockfile that disagrees with a manifest is rejected", () => {
    withSnapshot((dir) => {
      const manifest = join(dir, "apps/docs/package.json");
      const docs = JSON.parse(readFileSync(manifest, "utf-8"));
      docs.dependencies = { ...docs.dependencies, "left-pad": "1.3.0" };
      writeFileSync(manifest, JSON.stringify(docs, null, 2));
      const result = runFrozenCheck(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("lockfile had changes");
    });
  });
});
