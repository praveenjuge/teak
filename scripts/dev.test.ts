import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDevCommand,
  DEV_TARGETS,
  needsWebEnv,
  parseDevArgs,
} from "./dev.ts";

const ROOT = join(import.meta.dir, "..");

describe("parseDevArgs", () => {
  test("defaults to web", () => {
    expect(parseDevArgs([])).toEqual({
      action: "run",
      all: false,
      headless: false,
      target: "web",
    });
  });

  test("parses --headless and matrix aliases", () => {
    expect(parseDevArgs(["web", "--headless"]).headless).toBe(true);
    expect(parseDevArgs(["mobile-simulator"]).target).toBe("mobile");
    expect(parseDevArgs(["mobile-device"]).target).toBe("mobile");
    expect(parseDevArgs(["files-worker"]).target).toBe("files");
  });

  test("parses a single target", () => {
    expect(parseDevArgs(["mobile"]).target).toBe("mobile");
  });

  test("parses --all and --check", () => {
    expect(parseDevArgs(["--all"]).all).toBe(true);
    expect(parseDevArgs(["--check", "web"]).action).toBe("check");
  });

  test("rejects unknown targets", () => {
    expect(() => parseDevArgs(["unknown-surface"])).toThrow();
  });

  test("rejects unknown flags", () => {
    expect(() => parseDevArgs(["--typo", "mobile"])).toThrow();
  });

  test("rejects multiple targets", () => {
    expect(() => parseDevArgs(["mobile", "desktop"])).toThrow();
  });
});

describe("buildDevCommand", () => {
  test("web maps to web + convex filters", () => {
    expect(buildDevCommand("web")).toEqual([
      "turbo",
      "watch",
      "dev",
      "--ui=tui",
      "--filter",
      "@teak/web",
      "--filter",
      "@teak/convex",
    ]);
  });

  test("--all starts every surface", () => {
    expect(buildDevCommand("web", { all: true })).toEqual([
      "turbo",
      "watch",
      "dev",
      "--ui=tui",
    ]);
  });

  test("headless uses stream output", () => {
    expect(buildDevCommand("web", { headless: true })).toEqual([
      "turbo",
      "watch",
      "dev",
      "--ui=stream",
      "--filter",
      "@teak/web",
      "--filter",
      "@teak/convex",
    ]);
  });

  test("files targets use workspace filter", () => {
    expect(buildDevCommand("files")).toEqual([
      "bun",
      "run",
      "--filter",
      "@teak/files-worker",
      "dev",
    ]);
  });

  test("every documented target has filters", () => {
    for (const target of Object.keys(DEV_TARGETS)) {
      expect(buildDevCommand(target)[0]).toBe("turbo");
    }
  });
});

describe("dev target filters", () => {
  const manifestFor = (filter: string): string => {
    if (filter.startsWith(".")) {
      return join(ROOT, filter, "package.json");
    }
    for (const dir of ["apps", "packages"]) {
      for (const entry of readdirSync(join(ROOT, dir), {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const manifest = join(ROOT, dir, entry.name, "package.json");
        if (!existsSync(manifest)) {
          continue;
        }
        const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
          name?: string;
        };
        if (pkg.name === filter) {
          return manifest;
        }
      }
    }
    throw new Error(`No workspace found for dev filter "${filter}"`);
  };

  test("every dev target filter has a dev script", () => {
    for (const [target, filters] of Object.entries(DEV_TARGETS)) {
      for (const filter of filters) {
        const manifest = manifestFor(filter);
        expect(existsSync(manifest)).toBe(true);
        const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
          scripts?: Record<string, string>;
        };
        expect(
          pkg.scripts?.dev,
          `${target} filter ${filter} must have a dev script`
        ).toBeDefined();
      }
    }
  });

  test("files targets use scripts the worker defines", () => {
    const manifest = manifestFor("@teak/files-worker");
    const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.dev).toBeDefined();
    expect(pkg.scripts?.["dev:local"]).toBeDefined();
  });
});

describe("needsWebEnv", () => {
  test("web and --all need web env", () => {
    expect(needsWebEnv("web")).toBe(true);
    expect(needsWebEnv("convex", true)).toBe(true);
  });

  test("extension and convex do not need web env", () => {
    expect(needsWebEnv("extension")).toBe(false);
    expect(needsWebEnv("convex")).toBe(false);
  });
});
