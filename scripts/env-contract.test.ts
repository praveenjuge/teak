import { describe, expect, test } from "bun:test";
import {
  DELETED_ALIASES,
  ENV_CONTRACT,
  ENV_VAR_NAMES,
  getEnvSpec,
  isDeletedAlias,
  isPlatformVar,
  PLATFORM_EXACT,
  SECRET_VAR_NAMES,
} from "./env-contract.ts";

describe("env-contract", () => {
  test("names are unique", () => {
    expect(ENV_VAR_NAMES.size).toBe(ENV_CONTRACT.length);
  });

  test("every entry records owner, target, profile, secrecy, validation, provider, and required state", () => {
    for (const entry of ENV_CONTRACT) {
      expect(entry.owners.length).toBeGreaterThan(0);
      expect(entry.targets.length).toBeGreaterThan(0);
      expect(entry.profiles.length).toBeGreaterThan(0);
      expect(typeof entry.secret).toBe("boolean");
      expect(entry.validation).toBeTruthy();
      expect(entry.providers.length).toBeGreaterThan(0);
      expect(typeof entry.required).toBe("boolean");
      if (entry.required) {
        expect(entry.requiredIn?.length ?? 0).toBeGreaterThan(0);
      }
      if (entry.validation === "enum") {
        expect(entry.allowedValues?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  test("required profiles are a subset of profiles", () => {
    for (const entry of ENV_CONTRACT) {
      for (const profile of entry.requiredIn ?? []) {
        expect(entry.profiles).toContain(profile);
      }
    }
  });

  test("deleted aliases are not in the contract", () => {
    for (const alias of DELETED_ALIASES) {
      expect(ENV_VAR_NAMES.has(alias)).toBe(false);
      expect(isDeletedAlias(alias)).toBe(true);
    }
  });

  test("platform values are not in the contract", () => {
    for (const name of PLATFORM_EXACT) {
      expect(ENV_VAR_NAMES.has(name)).toBe(false);
      expect(isPlatformVar(name)).toBe(true);
    }
    for (const name of [
      "GITHUB_SHA",
      "RUNNER_TEMP",
      "VERCEL_ENV",
      "PLAYWRIGHT_BASE_URL",
      "MAIN_WINDOW_VITE_DEV_SERVER_URL",
      "npm_package_version",
      "EAS_BUILD_PROFILE",
      "EXPO_OS",
    ]) {
      expect(isPlatformVar(name)).toBe(true);
    }
  });

  test("platform patterns do not swallow operator-owned prefixes", () => {
    for (const name of [
      "EXPO_PUBLIC_CONVEX_URL",
      "E2E_PUBLIC_ORIGIN",
      "NEXT_PUBLIC_CONVEX_URL",
      "VITE_PUBLIC_CONVEX_URL",
    ]) {
      expect(isPlatformVar(name)).toBe(false);
    }
  });

  test("secret names resolve through getEnvSpec", () => {
    for (const name of SECRET_VAR_NAMES) {
      expect(getEnvSpec(name)?.secret).toBe(true);
    }
    expect(getEnvSpec("SITE_URL")?.secret).toBe(false);
    expect(getEnvSpec("DOES_NOT_EXIST")).toBeUndefined();
  });

  test("preserved compatibility entries exist", () => {
    expect(getEnvSpec("TEAK_ADMIN_EMAIL")).toBeDefined();
  });
});
