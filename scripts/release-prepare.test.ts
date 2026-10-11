import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  readVersion,
  resolveBump,
  setAppleMarketingVersion,
  setManifestVersion,
  setSafariXcodeVersion,
  updateManifestVersions,
  writeFileAtomically,
} from "./release-prepare.ts";
import { appleVersionSources, safariXcodeProject } from "./release-version.mjs";

const writeManifest = (path: string, version: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ name: "x", version })}\n`);
};

const writeSafariProject = (
  root: string,
  marketing: string,
  build: number
): string => {
  const projectPath = resolve(root, safariXcodeProject);
  mkdirSync(dirname(projectPath), { recursive: true });
  writeFileSync(
    projectPath,
    `MARKETING_VERSION = ${marketing};\nCURRENT_PROJECT_VERSION = ${build};\n`
  );
  return projectPath;
};

const appleSafariManifest =
  "apps/apple/SafariExtension/Resources/manifest.json";
const appleProjectYml = (version: string) =>
  `settings:\n  base:\n    MARKETING_VERSION: ${version}\n    CURRENT_PROJECT_VERSION: "1"\n`;
const applePbxproj = (version: string) =>
  `\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n\t\t\t\tMARKETING_VERSION = ${version};\n\t\t\t\tMARKETING_VERSION = ${version};\n`;

const writeAppleSources = (root: string, version: string): void => {
  const [projectYml, pbxproj] = appleVersionSources;
  for (const [relative, contents] of [
    [projectYml, appleProjectYml(version)],
    [pbxproj, applePbxproj(version)],
  ] as const) {
    const absolute = resolve(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  writeManifest(join(root, appleSafariManifest), version);
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

describe("writeFileAtomically", () => {
  test("removes its temporary file when replacement fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-release-"));
    const destination = join(dir, "destination");
    mkdirSync(destination);

    expect(() => writeFileAtomically(destination, "replacement")).toThrow();
    expect(existsSync(`${destination}.${process.pid}.tmp`)).toBe(false);
  });
});

describe("setSafariXcodeVersion", () => {
  test("updates native marketing and build versions", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-release-"));
    const projectPath = writeSafariProject(root, "1.0.39", 1);
    expect(setSafariXcodeVersion(projectPath, "1.0.66")).toBe(true);
    expect(readFileSync(projectPath, "utf-8")).toBe(
      "MARKETING_VERSION = 1.0.66;\nCURRENT_PROJECT_VERSION = 66;\n"
    );
    expect(setSafariXcodeVersion(projectPath, "1.0.66")).toBe(false);
  });
});

describe("setAppleMarketingVersion", () => {
  test("updates project.yml and the generated project without touching build numbers", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-release-"));
    writeAppleSources(root, "1.0.85");
    const [projectYml, pbxproj] = appleVersionSources.map((relative) =>
      resolve(root, relative)
    );
    expect(setAppleMarketingVersion(projectYml, "1.0.86")).toBe(true);
    expect(setAppleMarketingVersion(pbxproj, "1.0.86")).toBe(true);
    expect(readFileSync(projectYml, "utf-8")).toBe(appleProjectYml("1.0.86"));
    expect(readFileSync(pbxproj, "utf-8")).toBe(applePbxproj("1.0.86"));
    expect(setAppleMarketingVersion(projectYml, "1.0.86")).toBe(false);
  });

  test("fails when a source has no marketing version", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-release-"));
    const path = join(root, "project.yml");
    writeFileSync(path, "name: Teak\n");
    expect(() => setAppleMarketingVersion(path, "1.0.86")).toThrow(
      "Missing Apple MARKETING_VERSION"
    );
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
    writeManifest(
      join(root, "apps/mac/Shared (Extension)/Resources/manifest.json"),
      "1.0.39"
    );
    const projectPath = writeSafariProject(root, "1.0.39", 1);
    writeAppleSources(root, "1.0.65");
    const updated = updateManifestVersions(root, "1.0.66");
    expect(updated).toContain("package.json");
    expect(updated).toContain("apps/web/package.json");
    expect(updated).toContain("packages/ui/package.json");
    expect(updated).toContain(
      "apps/mac/Shared (Extension)/Resources/manifest.json"
    );
    expect(updated).toContain(safariXcodeProject);
    expect(updated).toContain(appleSafariManifest);
    for (const relative of appleVersionSources) {
      expect(updated).toContain(relative);
      expect(readFileSync(resolve(root, relative), "utf-8")).toContain(
        "1.0.66"
      );
    }
    expect(readVersion(join(root, appleSafariManifest))).toBe("1.0.66");
    expect(readVersion(join(root, "packages/ui/package.json"))).toBe("1.0.66");
    expect(
      readVersion(
        join(root, "apps/mac/Shared (Extension)/Resources/manifest.json")
      )
    ).toBe("1.0.66");
    expect(readFileSync(projectPath, "utf-8")).toContain(
      "CURRENT_PROJECT_VERSION = 66;"
    );
    expect(readFileSync(projectPath, "utf-8")).toContain(
      "MARKETING_VERSION = 1.0.66;"
    );
  });

  test("skips manifests already at the target version", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-release-"));
    writeManifest(join(root, "package.json"), "1.0.66");
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "packages"), { recursive: true });
    writeManifest(
      join(root, "apps/mac/Shared (Extension)/Resources/manifest.json"),
      "1.0.66"
    );
    writeSafariProject(root, "1.0.66", 66);
    writeAppleSources(root, "1.0.66");
    expect(updateManifestVersions(root, "1.0.66")).toEqual([]);
  });
});
