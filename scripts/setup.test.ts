import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkBunVersion,
  ensureFile,
  ensureWebEnv,
  isInstallStale,
  requiredBunVersion,
  webEnvTemplate,
} from "./setup.ts";

describe("requiredBunVersion", () => {
  test("parses the packageManager field", () => {
    expect(requiredBunVersion("bun@1.4.0")).toBe("1.4.0");
  });

  test("rejects unparseable values", () => {
    expect(() => requiredBunVersion("bun@latest")).toThrow();
  });
});

describe("checkBunVersion", () => {
  test("ok on exact match", () => {
    expect(checkBunVersion("1.4.0", "1.4.0")).toBe("ok");
  });

  test("warn on patch drift", () => {
    expect(checkBunVersion("1.4.1", "1.4.0")).toBe("warn");
  });

  test("mismatch on minor drift", () => {
    expect(checkBunVersion("1.5.0", "1.4.0")).toBe("mismatch");
  });
});

describe("webEnvTemplate", () => {
  test("contains the local Convex URLs", () => {
    const template = webEnvTemplate();
    expect(template).toContain("NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210");
    expect(template).toContain(
      "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211"
    );
  });
});

describe("ensureFile", () => {
  test("creates missing files but never overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const path = join(dir, "nested", ".env.local");
    expect(ensureFile(path, "A=1\n")).toBe("created");
    expect(readFileSync(path, "utf-8")).toBe("A=1\n");
    expect(ensureFile(path, "B=2\n")).toBe("exists");
    expect(readFileSync(path, "utf-8")).toBe("A=1\n");
  });
});

describe("ensureWebEnv", () => {
  test("repairs missing keys without overwriting existing values", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const path = join(dir, ".env.local");
    writeFileSync(path, "NEXT_PUBLIC_CONVEX_URL=http://custom\n");
    expect(ensureWebEnv(path)).toBe("repaired");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("NEXT_PUBLIC_CONVEX_URL=http://custom");
    expect(content).toContain(
      "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211"
    );
  });
});

describe("isInstallStale", () => {
  test("stale when node_modules is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-setup-"));
    writeFileSync(join(root, "bun.lock"), "lock");
    expect(isInstallStale(root)).toBe(true);
  });

  test("stale when bun.lock is newer than node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const modules = join(root, "node_modules");
    const lock = join(root, "bun.lock");
    mkdirSync(modules, { recursive: true });
    writeFileSync(lock, "lock");
    const now = new Date();
    utimesSync(
      modules,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 10_000)
    );
    utimesSync(lock, now, now);
    expect(isInstallStale(root)).toBe(true);
  });

  test("fresh when node_modules is newer than bun.lock", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const modules = join(root, "node_modules");
    const lock = join(root, "bun.lock");
    mkdirSync(modules, { recursive: true });
    writeFileSync(lock, "lock");
    const now = new Date();
    utimesSync(
      lock,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 10_000)
    );
    utimesSync(modules, now, now);
    expect(isInstallStale(root)).toBe(false);
  });
});
