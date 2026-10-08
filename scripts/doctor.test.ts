import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { isPortOccupied } from "./capabilities.ts";
import {
  checkE2EStack,
  checkTargetReadiness,
  evaluateWorkosPresence,
  findMissingKeys,
  needsConvexChecks,
  parseDoctorArgs,
  runDoctor,
} from "./doctor.ts";

describe("findMissingKeys", () => {
  test("reports keys absent from dotenv content", () => {
    const content = "# comment\nNEXT_PUBLIC_CONVEX_URL=http://x\n";
    expect(
      findMissingKeys(content, [
        "NEXT_PUBLIC_CONVEX_URL",
        "NEXT_PUBLIC_CONVEX_SITE_URL",
      ])
    ).toEqual(["NEXT_PUBLIC_CONVEX_SITE_URL"]);
  });

  test("empty when all keys present", () => {
    const content = "A=1\nB=2\n";
    expect(findMissingKeys(content, ["A", "B"])).toEqual([]);
  });

  test("flags empty and quoted-empty values as missing", () => {
    const content = "A=\nB=''\nC=\"value\"\n";
    expect(findMissingKeys(content, ["A", "B", "C"])).toEqual(["A", "B"]);
  });
});

describe("parseDoctorArgs", () => {
  test("defaults to human web local output", () => {
    expect(parseDoctorArgs(["bun", "doctor.ts"])).toEqual({
      json: false,
      profile: "local",
      target: "web",
    });
  });

  test("parses json target and profile", () => {
    expect(
      parseDoctorArgs([
        "bun",
        "doctor.ts",
        "--json",
        "--target",
        "convex",
        "--profile",
        "e2e",
      ])
    ).toEqual({ json: true, profile: "e2e", target: "convex" });
  });

  test("rejects unknown target profile and args", () => {
    expect(() =>
      parseDoctorArgs(["bun", "doctor.ts", "--target", "nope"])
    ).toThrow('--target "nope"');
    expect(() =>
      parseDoctorArgs(["bun", "doctor.ts", "--profile", "nope"])
    ).toThrow('--profile "nope"');
    expect(() => parseDoctorArgs(["bun", "doctor.ts", "--nope"])).toThrow(
      'Unknown argument "--nope"'
    );
  });

  test("rejects dashboard-owned profiles doctor cannot validate", () => {
    expect(() =>
      parseDoctorArgs(["bun", "doctor.ts", "--profile", "production"])
    ).toThrow('--profile "production"');
    expect(() =>
      parseDoctorArgs(["bun", "doctor.ts", "--profile", "preview"])
    ).toThrow('--profile "preview"');
  });
});

describe("evaluateWorkosPresence", () => {
  const presence = (clientId: string, apiKey: string) =>
    new Map([
      ["WORKOS_CLIENT_ID", clientId as "found" | "missing" | "unavailable"],
      ["WORKOS_API_KEY", apiKey as "found" | "missing" | "unavailable"],
    ]);

  test("passes when both credentials are set", () => {
    const check = evaluateWorkosPresence(presence("found", "found"));
    expect(check.ok).toBe(true);
    expect(check.severity).toBe("error");
  });

  test("fails naming the missing credential with a setup remediation", () => {
    const check = evaluateWorkosPresence(presence("found", "missing"));
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("WORKOS_API_KEY");
    expect(check.detail).not.toContain("WORKOS_CLIENT_ID");
    expect(check.remediation?.join(" ")).toContain("bun run setup");
  });

  test("warns when the deployment is unreachable", () => {
    const check = evaluateWorkosPresence(presence("unavailable", "found"));
    expect(check.ok).toBe(true);
    expect(check.severity).toBe("warn");
  });
});

describe("checkE2EStack", () => {
  test("passes when the web env points at the WorkOS emulator", () => {
    const check = checkE2EStack(
      new Map([
        ["WORKOS_CLIENT_ID", "client_01TEAKE2EEMULATOR"],
        ["WORKOS_API_HOSTNAME", "localhost"],
        ["WORKOS_API_PORT", "4100"],
        ["WORKOS_API_HTTPS", "false"],
      ])
    );
    expect(check.ok).toBe(true);
  });

  test("names what still points at hosted WorkOS", () => {
    const check = checkE2EStack(
      new Map([["WORKOS_CLIENT_ID", "client_STAGING"]])
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("WORKOS_CLIENT_ID");
    expect(check.detail).toContain("WORKOS_API_HOSTNAME");
    expect(check.detail).not.toContain("client_STAGING");
  });

  test("fails without a web env file", () => {
    expect(checkE2EStack(undefined).ok).toBe(false);
  });
});

describe("checkTargetReadiness", () => {
  test("flag-free targets are always ready", () => {
    expect(checkTargetReadiness("cli").ok).toBe(true);
    expect(checkTargetReadiness("docs").ok).toBe(true);
  });
});

describe("isPortOccupied", () => {
  test("detects a bound port and a free port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);
    expect(await isPortOccupied(port)).toBe(true);
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    expect(await isPortOccupied(port)).toBe(false);
  });
});

describe("needsConvexChecks", () => {
  test("is false only for targets that never consume convex", () => {
    expect(needsConvexChecks("docs")).toBe(false);
    expect(needsConvexChecks("cli")).toBe(false);
    expect(needsConvexChecks("files")).toBe(false);
    for (const target of [
      "web",
      "convex",
      "extension",
      "desktop",
      "mobile",
    ] as const) {
      expect(needsConvexChecks(target)).toBe(true);
    }
  });
});

describe("runDoctor", () => {
  test("docs report omits convex checks but keeps shared ones", async () => {
    const report = await runDoctor("docs", "local");
    const ids = report.checks.map((check) => check.id);
    for (const id of [
      "convex-isolation",
      "convex-generated",
      "convex-site-url",
      "capability-groups",
    ]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).toContain("target-readiness");
    expect(ids).toContain("env-audit");
    expect(report.target).toBe("docs");
    expect(report.profile).toBe("local");
    expect(report.version).toBe(1);
  });
});
