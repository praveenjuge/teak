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
  setManifestVersion,
  setSafariXcodeVersion,
  updateManifestVersions,
  writeFileAtomically,
} from "./release-prepare.ts";
import { safariXcodeProject } from "./release-version.mjs";

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
      join(
        root,
        "apps/safari-extension/Shared (Extension)/Resources/manifest.json"
      ),
      "1.0.39"
    );
    const projectPath = writeSafariProject(root, "1.0.39", 1);
    const updated = updateManifestVersions(root, "1.0.66");
    expect(updated).toContain("package.json");
    expect(updated).toContain("apps/web/package.json");
    expect(updated).toContain("packages/ui/package.json");
    expect(updated).toContain(
      "apps/safari-extension/Shared (Extension)/Resources/manifest.json"
    );
    expect(updated).toContain(safariXcodeProject);
    expect(readVersion(join(root, "packages/ui/package.json"))).toBe("1.0.66");
    expect(
      readVersion(
        join(
          root,
          "apps/safari-extension/Shared (Extension)/Resources/manifest.json"
        )
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
      join(
        root,
        "apps/safari-extension/Shared (Extension)/Resources/manifest.json"
      ),
      "1.0.66"
    );
    writeSafariProject(root, "1.0.66", 66);
    expect(updateManifestVersions(root, "1.0.66")).toEqual([]);
  });
});
