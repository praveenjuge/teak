import { describe, expect, test } from "bun:test";
import {
  checkBunVersion,
  convexModeProblem,
  parseSetupArgs,
  requiredBunVersion,
  resolveSetupConvex,
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

describe("convexModeProblem", () => {
  test("local backends are only for the E2E suite", () => {
    expect(convexModeProblem("web", "local")).toContain("E2E");
    expect(convexModeProblem("extension", "local")).toContain("E2E");
    expect(convexModeProblem("e2e", "local")).toBeNull();
  });

  test("the E2E suite never uses the cloud dev deployment", () => {
    expect(convexModeProblem("e2e", "cloud")).toContain("local backend");
    expect(convexModeProblem("web", "cloud")).toBeNull();
    expect(convexModeProblem("docs", "skip")).toBeNull();
  });
});

describe("parseSetupArgs", () => {
  test("defaults to web local human output", () => {
    expect(parseSetupArgs(["bun", "setup.ts"])).toEqual({
      target: "web",
      convex: null,
      check: false,
      json: false,
      push: true,
    });
  });

  test("parses --skip-push and refuses the retired --workos flag", () => {
    expect(parseSetupArgs(["bun", "setup.ts", "--skip-push"]).push).toBe(false);
    expect(() =>
      parseSetupArgs(["bun", "setup.ts", "--workos", "staging"])
    ).toThrow("Unknown argument");
  });

  test("parses target, convex, check, and json", () => {
    expect(
      parseSetupArgs([
        "bun",
        "setup.ts",
        "--target",
        "extension",
        "--convex",
        "cloud",
        "--check",
        "--json",
      ])
    ).toEqual({
      target: "extension",
      convex: "cloud",
      check: true,
      json: true,
      push: true,
    });
  });

  test("rejects unknown convex modes and arguments", () => {
    expect(() =>
      parseSetupArgs(["bun", "setup.ts", "--convex", "mars"])
    ).toThrow('Unknown --convex "mars"');
    expect(() => parseSetupArgs(["bun", "setup.ts", "--nope"])).toThrow(
      "Unknown argument"
    );
    expect(() => parseSetupArgs(["bun", "setup.ts", "--help"])).toThrow("help");
  });
});

describe("resolveSetupConvex", () => {
  test("explicit mode wins over the matrix default", () => {
    expect(resolveSetupConvex("web", "cloud")).toBe("cloud");
    expect(resolveSetupConvex("docs", "local")).toBe("local");
  });

  test("matrix defaults apply without an explicit mode", () => {
    expect(resolveSetupConvex("web", null)).toBe("cloud");
    expect(resolveSetupConvex("extension", null)).toBe("cloud");
    expect(resolveSetupConvex("docs", null)).toBe("skip");
    expect(resolveSetupConvex("cli", null)).toBe("skip");
    expect(resolveSetupConvex("files-worker", null)).toBe("skip");
    expect(resolveSetupConvex("e2e", null)).toBe("local");
  });
});
