import { describe, expect, test } from "bun:test";
import {
  buildDevCommand,
  DEV_TARGETS,
  needsWebEnv,
  parseDevArgs,
} from "./dev.ts";

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
