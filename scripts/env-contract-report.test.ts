import { describe, expect, test } from "bun:test";
import { ENV_CONTRACT } from "./env-contract.ts";
import {
  buildContractReport,
  exampleForValidation,
  isManuallySupplied,
  missingEntries,
} from "./env-contract-report.ts";
import { spec } from "./env-contract-types.ts";

describe("env-contract-report", () => {
  test("live totals match the contract", () => {
    const report = buildContractReport();
    expect(report.total).toBe(ENV_CONTRACT.length);
    expect(report.required).toBe(
      ENV_CONTRACT.filter((entry) => entry.required).length
    );
    expect(report.secrets).toBe(
      ENV_CONTRACT.filter((entry) => entry.secret).length
    );
    expect(report.implicit).toBe(
      ENV_CONTRACT.filter((entry) => entry.implicit).length
    );
    expect(report.bindings).toBe(
      ENV_CONTRACT.filter((entry) => entry.kind === "binding").length
    );
    expect(report.version).toBe(1);
  });

  test("generated aliases are not manually supplied", () => {
    const alias = spec("NEXT_PUBLIC_CONVEX_URL", {
      owners: ["@teak/web"],
      targets: ["web"],
      profiles: ["local"],
      secret: false,
      validation: "url",
      providers: ["dotenv-local"],
      required: true,
      requiredIn: ["local"],
    });
    const manual = spec("SITE_URL", {
      owners: ["@teak/convex"],
      targets: ["convex"],
      profiles: ["local"],
      secret: false,
      validation: "url",
      providers: ["convex-dashboard"],
      required: true,
      requiredIn: ["local"],
    });
    expect(isManuallySupplied(alias)).toBe(false);
    expect(isManuallySupplied(manual)).toBe(true);
    const report = buildContractReport([alias, manual]);
    expect(report.total).toBe(2);
    expect(report.aliases).toBe(1);
    expect(report.byTargetProfile).toContainEqual({
      target: "web",
      profile: "local",
      required: 1,
      manualRequired: 0,
    });
    expect(report.byTargetProfile).toContainEqual({
      target: "convex",
      profile: "local",
      required: 1,
      manualRequired: 1,
    });
  });

  test("live web/local manual inputs are near zero", () => {
    const report = buildContractReport();
    const webLocal = report.byTargetProfile.find(
      (counts) => counts.target === "web" && counts.profile === "local"
    );
    expect(webLocal?.manualRequired ?? 0).toBeLessThanOrEqual(1);
  });

  test("examples are placeholders by validation shape", () => {
    expect(exampleForValidation("url")).toBe("https://example.com");
    expect(exampleForValidation("email")).toBe("you@example.com");
    expect(exampleForValidation("sha")).toContain("hex");
    expect(exampleForValidation("enum", ["a", "b"])).toBe("a");
    expect(exampleForValidation("string")).toBe("<value>");
  });

  test("missing entries list absent required names with reasons", () => {
    const alias = spec("NEXT_PUBLIC_CONVEX_URL", {
      owners: ["@teak/web"],
      targets: ["web"],
      profiles: ["local"],
      secret: false,
      validation: "url",
      providers: ["dotenv-local"],
      required: true,
      requiredIn: ["local"],
      derivedFrom: "CONVEX_URL",
    });
    const manual = spec("SITE_URL", {
      owners: ["@teak/convex"],
      targets: ["convex"],
      profiles: ["local"],
      secret: false,
      validation: "url",
      providers: ["convex-dashboard"],
      required: true,
      requiredIn: ["local"],
    });
    const missing = missingEntries("web", "local", new Set(), [alias, manual]);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.name).toBe("NEXT_PUBLIC_CONVEX_URL");
    expect(missing[0]?.reason).toContain("CONVEX_URL");
    expect(missing[0]?.example).toContain("NEXT_PUBLIC_CONVEX_URL=");
    expect(
      missingEntries("web", "local", new Set(["NEXT_PUBLIC_CONVEX_URL"]), [
        alias,
        manual,
      ])
    ).toHaveLength(0);
  });
});
