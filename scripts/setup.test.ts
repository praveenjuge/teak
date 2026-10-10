import { describe, expect, test } from "bun:test";
import {
  checkBunVersion,
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

describe("parseSetupArgs", () => {
  test("defaults to web local human output", () => {
    expect(parseSetupArgs(["bun", "setup.ts"])).toEqual({
      target: "web",
      convex: null,
      check: false,
      json: false,
    });
  });

  test("refuses the retired --workos and --skip-push flags", () => {
    expect(() =>
      parseSetupArgs(["bun", "setup.ts", "--workos", "staging"])
    ).toThrow("Unknown argument");
    expect(() => parseSetupArgs(["bun", "setup.ts", "--skip-push"])).toThrow(
      "Unknown argument"
    );
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
    });
  });

  test("rejects unknown convex modes and arguments", () => {
    expect(() =>
      parseSetupArgs(["bun", "setup.ts", "--convex", "mars"])
    ).toThrow('Unknown --convex "mars"');
    // Local backends are the E2E suite's own (packages/tests).
    expect(() =>
      parseSetupArgs(["bun", "setup.ts", "--convex", "local"])
    ).toThrow('Unknown --convex "local"');
    expect(() => parseSetupArgs(["bun", "setup.ts", "--nope"])).toThrow(
      "Unknown argument"
    );
    expect(() => parseSetupArgs(["bun", "setup.ts", "--help"])).toThrow("help");
  });
});

describe("resolveSetupConvex", () => {
  test("explicit mode wins over the matrix default", () => {
    expect(resolveSetupConvex("web", "cloud")).toBe("cloud");
    expect(resolveSetupConvex("docs", "cloud")).toBe("cloud");
  });

  test("matrix defaults apply without an explicit mode", () => {
    expect(resolveSetupConvex("web", null)).toBe("cloud");
    expect(resolveSetupConvex("extension", null)).toBe("cloud");
    expect(resolveSetupConvex("docs", null)).toBe("skip");
    expect(resolveSetupConvex("cli", null)).toBe("skip");
    expect(resolveSetupConvex("files-worker", null)).toBe("skip");
  });
});
