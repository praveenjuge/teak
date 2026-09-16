import { describe, expect, test } from "bun:test";
import {
  assertNoProductionConvex,
  checkBunVersion,
  isProductionDeployment,
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

describe("production refusal", () => {
  test("detects prod: deployments only", () => {
    expect(isProductionDeployment("prod:main")).toBe(true);
    expect(isProductionDeployment("dev:main")).toBe(false);
    expect(isProductionDeployment("anonymous:local")).toBe(false);
    expect(isProductionDeployment(undefined)).toBe(false);
  });

  test("refuses deploy keys and prod selections", () => {
    expect(() =>
      assertNoProductionConvex({ source: "none" }, "prod-key")
    ).toThrow("CONVEX_DEPLOY_KEY");
    expect(() =>
      assertNoProductionConvex({ deployment: "prod:main", source: "env" })
    ).toThrow("production");
    expect(() =>
      assertNoProductionConvex({ deployment: "dev:main", source: "dotenv" })
    ).not.toThrow();
    expect(() => assertNoProductionConvex({ source: "none" })).not.toThrow();
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

  test("parses target, convex, check, and json", () => {
    expect(
      parseSetupArgs([
        "bun",
        "setup.ts",
        "--target",
        "desktop",
        "--convex",
        "cloud",
        "--check",
        "--json",
      ])
    ).toEqual({ target: "desktop", convex: "cloud", check: true, json: true });
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
    expect(resolveSetupConvex("web", null)).toBe("local");
    expect(resolveSetupConvex("docs", null)).toBe("skip");
    expect(resolveSetupConvex("cli", null)).toBe("skip");
    expect(resolveSetupConvex("files-worker", null)).toBe("skip");
    expect(resolveSetupConvex("e2e", null)).toBe("cloud");
  });
});
