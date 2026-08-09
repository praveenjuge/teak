import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertLockstep,
  assertPatchBump,
  packageFiles,
  parseVersion,
} from "./release-version.mjs";

describe("release versions", () => {
  test("accepts only stable three-component versions", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(() => parseVersion("1.2")).toThrow();
    expect(() => parseVersion("1.2.3-beta.1")).toThrow();
  });

  test("permits only the next patch", () => {
    expect(() => assertPatchBump("1.0.59", "1.0.60")).not.toThrow();
    expect(() => assertPatchBump("1.0.59", "1.1.0")).toThrow();
    expect(() => assertPatchBump("1.0.59", "1.0.61")).toThrow();
    expect(() => assertPatchBump("1.0.59", "1.0.59")).toThrow();
  });

  test("checks every root and workspace package", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "teak-release-version-")
    );
    try {
      for (const directory of ["apps/web", "packages/ui"]) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
      }
      for (const relative of [
        "package.json",
        "apps/web/package.json",
        "packages/ui/package.json",
      ]) {
        fs.writeFileSync(
          path.join(root, relative),
          `${JSON.stringify({ version: "1.0.60" })}\n`
        );
      }

      expect(packageFiles(root)).toEqual([
        "apps/web/package.json",
        "package.json",
        "packages/ui/package.json",
      ]);
      expect(() => assertLockstep(root, "1.0.60")).not.toThrow();

      fs.writeFileSync(
        path.join(root, "packages/ui/package.json"),
        `${JSON.stringify({ version: "1.0.59" })}\n`
      );
      expect(() => assertLockstep(root, "1.0.60")).toThrow(
        "packages/ui/package.json: 1.0.59"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
