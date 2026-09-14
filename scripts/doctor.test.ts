import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import {
  checkE2EVars,
  checkTargetReadiness,
  evaluateCapabilityGroups,
  findMissingKeys,
  isPortOccupied,
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

describe("evaluateCapabilityGroups", () => {
  const names = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_CLIENT_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY",
    "APPLE_TEAM_ID",
  ];

  test("whole and absent groups pass", () => {
    const whole = new Map(names.map((name) => [name, "found" as const]));
    expect(evaluateCapabilityGroups(whole)).toEqual({
      broken: [],
      unknown: false,
    });
    const absent = new Map(names.map((name) => [name, "missing" as const]));
    expect(evaluateCapabilityGroups(absent)).toEqual({
      broken: [],
      unknown: false,
    });
  });

  test("partial groups name the missing variables", () => {
    const presence = new Map(names.map((name) => [name, "missing" as const]));
    presence.set("GOOGLE_CLIENT_ID", "found");
    const { broken, unknown } = evaluateCapabilityGroups(presence);
    expect(unknown).toBe(false);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain("GOOGLE_CLIENT_SECRET");
  });

  test("unreachable deployments report unknown", () => {
    const presence = new Map(
      names.map((name) => [name, "unavailable" as const])
    );
    expect(evaluateCapabilityGroups(presence)).toEqual({
      broken: [],
      unknown: true,
    });
  });
});

describe("checkE2EVars", () => {
  test("names every missing variable", () => {
    const check = checkE2EVars({});
    expect(check.ok).toBe(false);
    expect(check.id).toBe("e2e-vars");
    expect(check.detail).toContain("E2E_CONVEX_URL");
  });

  test("passes when all required variables are present", () => {
    const check = checkE2EVars({
      E2E_CLEANUP_TOKEN: "x",
      E2E_CONVEX_SITE_URL: "x",
      E2E_CONVEX_URL: "x",
      E2E_EMAIL_DOMAIN: "x",
      MAILPIT_URL: "x",
      PROD_E2E_PASSWORD: "x",
    });
    expect(check.ok).toBe(true);
  });
});

describe("checkTargetReadiness", () => {
  test("flag-free targets are always ready", () => {
    expect(checkTargetReadiness("cli").ok).toBe(true);
    expect(checkTargetReadiness("docs").ok).toBe(true);
  });
});

describe("diagnostic secrecy", () => {
  test("reports never contain secret values", () => {
    const sentinel = "sentinel-secret-value-9f8e7d";
    const present = JSON.stringify(
      checkE2EVars({
        E2E_CLEANUP_TOKEN: sentinel,
        E2E_CONVEX_SITE_URL: "https://site.example",
        E2E_CONVEX_URL: "https://convex.example",
        E2E_EMAIL_DOMAIN: "example.com",
        MAILPIT_URL: "https://mailpit.example",
        PROD_E2E_PASSWORD: sentinel,
      })
    );
    expect(present).not.toContain(sentinel);
    const missing = JSON.stringify(checkE2EVars({}));
    expect(missing).not.toContain(sentinel);
    expect(missing).toContain("E2E_CLEANUP_TOKEN");
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
