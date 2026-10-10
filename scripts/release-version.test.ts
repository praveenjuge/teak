import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appleVersionSources,
  assertLockstep,
  assertPatchBump,
  npmLockFiles,
  packageFiles,
  parseVersion,
  releaseManifestFiles,
  safariXcodeProject,
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
      for (const directory of [
        "apps/web",
        "packages/ui",
        "apps/mac/Shared (Extension)/Resources",
        "apps/mac/teak-mac.xcodeproj",
        "apps/apple/SafariExtension/Resources",
        "apps/apple/Teak.xcodeproj",
      ]) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
      }
      for (const relative of [
        "package.json",
        "apps/web/package.json",
        "packages/ui/package.json",
        "apps/apple/SafariExtension/Resources/manifest.json",
      ]) {
        fs.writeFileSync(
          path.join(root, relative),
          `${JSON.stringify({ version: "1.0.60" })}\n`
        );
      }
      const [appleProjectYml, applePbxproj] = appleVersionSources;
      const writeAppleVersion = (version: string) => {
        fs.writeFileSync(
          path.join(root, appleProjectYml),
          `settings:\n  base:\n    MARKETING_VERSION: ${version}\n`
        );
        fs.writeFileSync(
          path.join(root, applePbxproj),
          `MARKETING_VERSION = ${version};\nMARKETING_VERSION = ${version};\n`
        );
      };
      expect(() => assertLockstep(root, "1.0.60")).toThrow(
        `${appleProjectYml}: missing`
      );
      writeAppleVersion("1.0.60");

      expect(() => assertLockstep(root, "1.0.60")).toThrow(
        "apps/mac/Shared (Extension)/Resources/manifest.json: missing"
      );

      expect(packageFiles(root)).toEqual([
        "apps/web/package.json",
        "package.json",
        "packages/ui/package.json",
      ]);
      fs.writeFileSync(
        path.join(root, "apps/mac/Shared (Extension)/Resources/manifest.json"),
        `${JSON.stringify({ version: "1.0.60" })}\n`
      );
      expect(() => assertLockstep(root, "1.0.60", null)).toThrow(
        `${safariXcodeProject}: missing`
      );
      const validXcodeSource =
        "MARKETING_VERSION = 1.0.60;\nCURRENT_PROJECT_VERSION = 60;\n";
      expect(releaseManifestFiles(root)).toEqual([
        "apps/apple/SafariExtension/Resources/manifest.json",
        "apps/mac/Shared (Extension)/Resources/manifest.json",
        "apps/web/package.json",
        "package.json",
        "packages/ui/package.json",
      ]);
      expect(npmLockFiles(root)).toEqual([]);
      expect(() =>
        assertLockstep(root, "1.0.60", validXcodeSource)
      ).not.toThrow();

      fs.writeFileSync(
        path.join(root, applePbxproj),
        "MARKETING_VERSION = 1.0.60;\nMARKETING_VERSION = 1.0.59;\n"
      );
      expect(() => assertLockstep(root, "1.0.60", validXcodeSource)).toThrow(
        `${applePbxproj} MARKETING_VERSION: 1.0.59`
      );
      // A temporary test fixture.
      // nosemgrep: javascript_pathtraversal_rule-non-literal-fs-filename
      fs.writeFileSync(path.join(root, appleProjectYml), "name: Teak\n");
      expect(() => assertLockstep(root, "1.0.60", validXcodeSource)).toThrow(
        `${appleProjectYml} MARKETING_VERSION: missing`
      );
      writeAppleVersion("1.0.60");
      fs.writeFileSync(
        path.join(root, "apps/apple/SafariExtension/Resources/manifest.json"),
        `${JSON.stringify({ version: "1.0.59" })}\n`
      );
      expect(() => assertLockstep(root, "1.0.60", validXcodeSource)).toThrow(
        "apps/apple/SafariExtension/Resources/manifest.json: 1.0.59"
      );
      fs.writeFileSync(
        path.join(root, "apps/apple/SafariExtension/Resources/manifest.json"),
        `${JSON.stringify({ version: "1.0.60" })}\n`
      );

      const staleXcodeSource =
        "MARKETING_VERSION = 1.0.59;\nCURRENT_PROJECT_VERSION = 59;\n";
      expect(() => assertLockstep(root, "1.0.60", staleXcodeSource)).toThrow(
        `${safariXcodeProject} MARKETING_VERSION: 1.0.59`
      );

      fs.writeFileSync(
        path.join(root, "apps/mac/Shared (Extension)/Resources/manifest.json"),
        `${JSON.stringify({ version: "1.0.59" })}\n`
      );
      expect(() => assertLockstep(root, "1.0.60", validXcodeSource)).toThrow(
        "apps/mac/Shared (Extension)/Resources/manifest.json: 1.0.59"
      );
      fs.writeFileSync(
        path.join(root, "apps/mac/Shared (Extension)/Resources/manifest.json"),
        `${JSON.stringify({ version: "1.0.60" })}\n`
      );

      fs.writeFileSync(
        path.join(root, "apps/web/package-lock.json"),
        `${JSON.stringify({
          version: "1.0.60",
          packages: { "": { version: "1.0.60" } },
        })}\n`
      );
      expect(npmLockFiles(root)).toEqual(["apps/web/package-lock.json"]);
      expect(() =>
        assertLockstep(root, "1.0.60", validXcodeSource)
      ).not.toThrow();

      fs.writeFileSync(
        path.join(root, "apps/web/package-lock.json"),
        `${JSON.stringify({
          version: "1.0.59",
          packages: { "": { version: "1.0.59" } },
        })}\n`
      );
      expect(() => assertLockstep(root, "1.0.60", validXcodeSource)).toThrow(
        "apps/web/package-lock.json version: 1.0.59"
      );

      fs.writeFileSync(
        path.join(root, "packages/ui/package.json"),
        `${JSON.stringify({ version: "1.0.59" })}\n`
      );
      expect(() => assertLockstep(root, "1.0.60", validXcodeSource)).toThrow(
        "packages/ui/package.json: 1.0.59"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
