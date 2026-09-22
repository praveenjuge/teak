import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRuntimeVersion,
  inferLanHost,
  isInstallStale,
  isPortOccupied,
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
  /** Fixture root with node_modules and bun.lock at controlled mtimes. */
  const createMockProject = (newer: "lock" | "modules"): { root: string } => {
    const root = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const modules = join(root, "node_modules");
    const lock = join(root, "bun.lock");
    mkdirSync(modules, { recursive: true });
    writeFileSync(lock, "lock");
    const now = new Date();
    const older = new Date(now.getTime() - 10_000);
    const [newerPath, olderPath] =
      newer === "lock" ? [lock, modules] : [modules, lock];
    utimesSync(newerPath, now, now);
    utimesSync(olderPath, older, older);
    return { root };
  };

  test("stale when node_modules is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-setup-"));
    writeFileSync(join(root, "bun.lock"), "lock");
    expect(isInstallStale(root)).toBe(true);
  });

  test("stale when bun.lock is newer than node_modules", () => {
    const { root } = createMockProject("lock");
    expect(isInstallStale(root)).toBe(true);
  });

  test("fresh when node_modules is newer than bun.lock", () => {
    const { root } = createMockProject("modules");
    expect(isInstallStale(root)).toBe(false);
  });

  test("markInstallFresh clears staleness after an install", () => {
    // Bun writes the lockfile last, so a fresh install looks stale.
    const { root } = createMockProject("lock");
    expect(isInstallStale(root)).toBe(true);
    markInstallFresh(root);
    expect(isInstallStale(root)).toBe(false);
  });
});

describe("network probes", () => {
  test("occupied ports are detected", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);
    expect(await isPortOccupied(port)).toBe(true);
    server.close();
  });

  test("lan host inference returns an address or null", () => {
    const lan = inferLanHost();
    expect(lan === null || /^\d+\.\d+\.\d+\.\d+$/.test(lan)).toBe(true);
  });
});
