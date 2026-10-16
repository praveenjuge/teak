import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRuntimeVersion,
  isInstallStale,
  markInstallFresh,
  readConvexSelection,
  readNodeVersion,
  readPinnedVersions,
  requiredNodeVersion,
} from "./capabilities.ts";

describe("checkRuntimeVersion", () => {
  test("ok on exact match with or without a v prefix", () => {
    expect(checkRuntimeVersion("1.4.0", "1.4.0")).toBe("ok");
    expect(checkRuntimeVersion("v22.23.2", "22.23.2")).toBe("ok");
  });

  test("warn on patch drift, mismatch otherwise", () => {
    expect(checkRuntimeVersion("v22.23.9", "22.23.2")).toBe("warn");
    expect(checkRuntimeVersion("v22.24.0", "22.23.2")).toBe("mismatch");
    expect(checkRuntimeVersion("v20.0.0", "22.23.2")).toBe("mismatch");
  });
});

describe("pinned versions", () => {
  test("engines.node must pin an exact version", () => {
    expect(requiredNodeVersion({ node: "22.23.2" }, "bun@1.4.0")).toBe(
      "22.23.2"
    );
    expect(() => requiredNodeVersion({}, "bun@1.4.0")).toThrow("engines.node");
    expect(() => requiredNodeVersion({ node: ">=22" }, "bun@1.4.0")).toThrow(
      "engines.node"
    );
  });

  test("live pins match package.json", () => {
    const root = join(import.meta.dir, "..");
    const pinned = readPinnedVersions(root);
    expect(pinned.bun).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pinned.node).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("system node is detected via subprocess", async () => {
    const actual = await readNodeVersion();
    expect(actual).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("readConvexSelection", () => {
  test("prefers the environment over dotenv", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const dotenv = join(dir, ".env.local");
    writeFileSync(dotenv, "CONVEX_DEPLOYMENT=dev:from-file\n");
    expect(
      readConvexSelection({ CONVEX_DEPLOYMENT: "dev:from-env" }, dotenv)
    ).toEqual({ deployment: "dev:from-env", source: "env" });
    expect(readConvexSelection({}, dotenv)).toEqual({
      deployment: "dev:from-file",
      source: "dotenv",
    });
    expect(readConvexSelection({}, join(dir, "absent"))).toEqual({
      source: "none",
    });
  });
});

describe("isInstallStale", () => {
  const createProject = (): string => {
    const root = mkdtempSync(join(tmpdir(), "teak-setup-"));
    writeFileSync(join(root, "bun.lock"), "lock v1");
    return root;
  };

  test("stale when node_modules is missing", () => {
    expect(isInstallStale(createProject())).toBe(true);
  });

  test("stale when node_modules was not installed by setup", () => {
    const root = createProject();
    mkdirSync(join(root, "node_modules"));
    expect(isInstallStale(root)).toBe(true);
  });

  test("fresh after setup marks the install of this bun.lock", () => {
    const root = createProject();
    mkdirSync(join(root, "node_modules"));
    markInstallFresh(root);
    expect(isInstallStale(root)).toBe(false);
  });

  test("stale again once bun.lock changes", () => {
    const root = createProject();
    mkdirSync(join(root, "node_modules"));
    markInstallFresh(root);
    writeFileSync(join(root, "bun.lock"), "lock v2");
    expect(isInstallStale(root)).toBe(true);
  });
});
