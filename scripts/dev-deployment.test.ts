import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEV_DEPLOYMENT,
  planDevSelection,
  resolveConvexAccess,
  selectDevDeployment,
  writeConvexSelection,
} from "./dev-deployment.ts";

const name = DEV_DEPLOYMENT.slice("dev:".length);

describe("resolveConvexAccess", () => {
  test("no key means the developer's Convex login", () => {
    expect(resolveConvexAccess(undefined)).toEqual({ kind: "login" });
    expect(resolveConvexAccess(" ")).toEqual({ kind: "login" });
  });

  test("accepts only a dev key for the shared dev deployment", () => {
    expect(resolveConvexAccess(`dev:${name}|eyJ0b2tlbiI6MX0=`)).toEqual({
      kind: "deploy-key",
    });
  });

  test.each([
    ["prod:teak-prod|eyJ0b2tlbiI6MX0=", "production"],
    ["preview:team:teak|eyJ0b2tlbiI6MX0=", "preview"],
    ["project:team:teak|eyJ0b2tlbiI6MX0=", "production included"],
    ["dev:other-otter-1|eyJ0b2tlbiI6MX0=", "other-otter-1"],
    ["bold-hyena-681|01c2", "admin key"],
  ])("refuses %s", (key, reason) => {
    const access = resolveConvexAccess(key);
    expect(access.kind).toBe("refused");
    expect(JSON.stringify(access)).toContain(reason);
    expect(JSON.stringify(access)).not.toContain("eyJ0b2tlbiI6MX0=");
  });
});

describe("planDevSelection", () => {
  test("keeps the shared dev deployment", () => {
    expect(planDevSelection(DEV_DEPLOYMENT)).toEqual({ action: "keep" });
  });

  test("selects it over nothing or a local backend the E2E stack left", () => {
    expect(planDevSelection(undefined).action).toBe("select");
    expect(planDevSelection("anonymous:anonymous-agent").action).toBe("select");
    expect(planDevSelection("local:teak").action).toBe("select");
  });

  test("refuses production and any other deployment a person chose", () => {
    expect(planDevSelection("prod:teak-prod")).toMatchObject({
      action: "refuse",
      detail: expect.stringContaining("production"),
    });
    expect(planDevSelection("dev:other-otter-1").action).toBe("refuse");
  });
});

describe("writeConvexSelection", () => {
  test("switches the selection and keeps every other line", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-selection-"));
    const path = join(dir, ".env.local");
    writeFileSync(
      path,
      "# Deployment used by `npx convex dev`\n\n# Deployment used by `npx convex dev`\nCONVEX_DEPLOYMENT=anonymous:anonymous-agent # team: x\n\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\nCUSTOM=kept\n"
    );
    selectDevDeployment(path);
    const selected = readFileSync(path, "utf-8");
    expect(selected).toContain(`CONVEX_DEPLOYMENT=${DEV_DEPLOYMENT}\n`);
    expect(selected).toContain(`CONVEX_URL=https://${name}.convex.cloud\n`);
    expect(selected).toContain("CUSTOM=kept");
    expect(selected).not.toContain("127.0.0.1");
    expect(selected.match(/# Deployment used/g)).toHaveLength(1);

    writeConvexSelection(path, null);
    const cleared = readFileSync(path, "utf-8");
    expect(cleared).not.toContain("CONVEX_DEPLOYMENT=");
    expect(cleared).toContain("CUSTOM=kept");
  });
});
