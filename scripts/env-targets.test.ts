import { describe, expect, test } from "bun:test";
import {
  CONVEX_DOTENV_FILE,
  isSupportedCombo,
  isSupportedTarget,
  SUPPORTED_DOTENV_FILES,
  SUPPORTED_TARGETS,
  TARGET_SPECS,
} from "./env-targets.ts";

describe("env-targets", () => {
  test("matrix covers every issue #407 target", () => {
    for (const target of [
      "web",
      "docs",
      "cli",
      "desktop",
      "extension",
      "mobile-simulator",
      "mobile-device",
      "files-worker",
      "e2e",
    ]) {
      expect(isSupportedTarget(target)).toBe(true);
    }
    expect(SUPPORTED_TARGETS.length).toBe(9);
  });

  test("every target declares profiles, files, and convex needs", () => {
    for (const target of SUPPORTED_TARGETS) {
      const spec = TARGET_SPECS[target];
      expect(spec.profiles.length).toBeGreaterThan(0);
      expect(typeof spec.needsConvex).toBe("boolean");
      expect(spec.note.length).toBeGreaterThan(0);
    }
  });

  test("supported combos gate target/profile pairs", () => {
    expect(isSupportedCombo("web", "local")).toBe(true);
    expect(isSupportedCombo("e2e", "e2e")).toBe(true);
    expect(isSupportedCombo("mobile-device", "local")).toBe(true);
    expect(isSupportedCombo("web", "e2e")).toBe(false);
    expect(isSupportedCombo("e2e", "local")).toBe(false);
    expect(isSupportedCombo("unknown", "local")).toBe(false);
  });

  test("dotenv files are repo-relative and unique", () => {
    const files = [...SUPPORTED_DOTENV_FILES];
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) {
      expect(file.startsWith("/")).toBe(false);
    }
    expect(CONVEX_DOTENV_FILE).toBe("packages/convex/.env.local");
  });

  test("e2e scope owns its own files, separate from web build inputs", () => {
    expect(TARGET_SPECS.e2e.dotenvFiles).toContain(".env.e2e.local");
    expect(TARGET_SPECS.e2e.dotenvFiles).toContain("apps/web/.env.e2e.local");
    expect(TARGET_SPECS.web.dotenvFiles).toEqual(["apps/web/.env.local"]);
  });
});
