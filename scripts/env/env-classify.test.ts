import { describe, expect, test } from "bun:test";
import {
  ALIAS_DERIVATIONS,
  CANONICAL_FACTS,
  frameworkAliases,
} from "./env-aliases.ts";
import {
  classify,
  derivationRule,
  exposureOf,
  primaryOwner,
} from "./env-classify.ts";
import { ENV_CONTRACT, ENV_VAR_NAMES, getEnvSpec } from "./env-contract.ts";

describe("env-classify", () => {
  test("every entry has exactly one owner and classification", () => {
    for (const entry of ENV_CONTRACT) {
      expect(primaryOwner(entry)).toBe(entry.owners[0]);
      expect([
        "secret",
        "public-config",
        "generated",
        "build-metadata",
        "platform-binding",
      ]).toContain(classify(entry));
    }
  });

  test("every classification bucket is reachable", () => {
    const buckets = new Set(ENV_CONTRACT.map(classify));
    for (const bucket of [
      "secret",
      "public-config",
      "generated",
      "build-metadata",
      "platform-binding",
    ] as const) {
      expect(buckets.has(bucket)).toBe(true);
    }
  });

  test("no secret entry is client-exposed", () => {
    for (const entry of ENV_CONTRACT) {
      if (entry.secret) {
        expect(exposureOf(entry)).toBe("server");
      }
    }
  });

  test("every framework alias is public and generated", () => {
    for (const name of frameworkAliases()) {
      const entry = getEnvSpec(name);
      expect(entry).toBeDefined();
      if (entry) {
        expect(exposureOf(entry)).toBe("public");
        expect(classify(entry)).toBe("generated");
      }
    }
  });

  test("alias map matches the contract exactly", () => {
    for (const canonical of CANONICAL_FACTS) {
      expect(ENV_VAR_NAMES.has(canonical)).toBe(true);
    }
    for (const [canonical, aliases] of Object.entries(ALIAS_DERIVATIONS)) {
      for (const alias of aliases) {
        expect(derivationRule(getEnvSpec(alias)!)).toBe(canonical);
      }
    }
  });

  test("derivedFrom references resolve or describe a source", () => {
    for (const entry of ENV_CONTRACT) {
      if (!entry.derivedFrom) {
        expect(derivationRule(entry)).toBe("supplied");
        continue;
      }
      const canonical = ENV_VAR_NAMES.has(entry.derivedFrom);
      const described = entry.derivedFrom.includes(" ");
      expect(canonical || described).toBe(true);
    }
  });
});
