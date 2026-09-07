import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readVersion,
  resolveBump,
  setManifestVersion,
  updateManifestVersions,
} from "./release-prepare.ts";

const writeManifest = (path: string, version: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ name: "x", version })}\n`);
};

describe("setManifestVersion", () => {
  test("rewrites the version field", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-release-"));
    const path = join(dir, "package.json");
    writeManifest(path, "1.0.65");
    setManifestVersion(path, "1.0.66");
    expect(readVersion(path)).toBe("1.0.66");
  });
});

describe("resolveBump", () => {
  test("fresh on the next patch", () => {
    expect(resolveBump("1.0.65", "1.0.66")).toBe("fresh");
  });

  test("resume requires the flag when already at the target version", () => {
    expect(resolveBump("1.0.66", "1.0.66", { resume: true })).toBe("resume");
    expect(() => resolveBump("1.0.66", "1.0.66")).toThrow();
  });

  test("rejects non-patch bumps", () => {
    expect(() => resolveBump("1.0.65", "1.1.0")).toThrow();
    expect(() => resolveBump("1.0.66", "1.0.65")).toThrow();
  });
});

describe("updateManifestVersions", () => {
  test("updates every tracked manifest to the target version", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-release-"));
    writeManifest(join(root, "package.json"), "1.0.65");
    writeManifest(join(root, "apps/web/package.json"), "1.0.65");
    writeManifest(join(root, "packages/ui/package.json"), "1.0.64");
    const updated = updateManifestVersions(root, "1.0.66");
    expect(updated).toContain("package.json");
    expect(updated).toContain("apps/web/package.json");
    expect(updated).toContain("packages/ui/package.json");
    expect(readVersion(join(root, "packages/ui/package.json"))).toBe("1.0.66");
  });

  test("skips manifests already at the target version", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-release-"));
    writeManifest(join(root, "package.json"), "1.0.66");
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "packages"), { recursive: true });
    expect(updateManifestVersions(root, "1.0.66")).toEqual([]);
  });
});
