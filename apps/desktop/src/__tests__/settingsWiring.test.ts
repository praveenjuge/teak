// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop settings wiring", () => {
  it("keeps active plan flows and removes unused subscription dialog state", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../pages/SettingsPage.tsx"),
      "utf8"
    );

    expect(source).toContain('buildWebUrl("/settings")');
    expect(source).toContain("createCustomerPortal");

    expect(source).not.toContain("subscriptionOpen");
    expect(source).not.toContain("loadingPlanId");
    expect(source).not.toContain("monthlyPlanId");
    expect(source).not.toContain("yearlyPlanId");
    expect(source).not.toContain("SubscriptionSection");
    expect(source).not.toContain('window.addEventListener("keydown"');
  });
});
