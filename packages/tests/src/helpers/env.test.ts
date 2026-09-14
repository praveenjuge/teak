import { afterEach, describe, expect, test } from "bun:test";

const MANAGED_NAMES = [
  "E2E_PUBLIC_ORIGIN",
  "E2E_APP_ORIGIN",
  "E2E_CONVEX_URL",
  "E2E_CONVEX_SITE_URL",
  "E2E_CLEANUP_TOKEN",
  "E2E_EMAIL_DOMAIN",
  "PROD_E2E_PASSWORD",
  "MAILPIT_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
];

const saved = new Map(MANAGED_NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of MANAGED_NAMES) {
    const value = saved.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

const loadEnv = async (tag: string) =>
  (await import(`./env.ts?env-test=${tag}`)).env;

describe("e2e env origins", () => {
  test("derives api and mcp paths from the default public origin", async () => {
    for (const name of MANAGED_NAMES) {
      delete process.env[name];
    }
    const env = await loadEnv("defaults");
    expect(env.siteUrl).toBe("https://teakvault.com");
    expect(env.apiUrl).toBe("https://teakvault.com/api");
    expect(env.mcpUrl).toBe("https://teakvault.com/mcp");
    expect(env.appUrl).toBe("https://app.teakvault.com");
  });

  test("derives api and mcp paths from a custom public origin", async () => {
    process.env.E2E_PUBLIC_ORIGIN = "https://staging.example.com/";
    process.env.E2E_APP_ORIGIN = "https://app.staging.example.com/";
    const env = await loadEnv("custom");
    expect(env.siteUrl).toBe("https://staging.example.com");
    expect(env.apiUrl).toBe("https://staging.example.com/api");
    expect(env.mcpUrl).toBe("https://staging.example.com/mcp");
    expect(env.appUrl).toBe("https://app.staging.example.com");
  });

  test("reads convex origins without framework fallbacks", async () => {
    process.env.E2E_CONVEX_URL = "https://convex.example.com";
    process.env.E2E_CONVEX_SITE_URL = "https://site.example.com";
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://wrong.example.com";
    const env = await loadEnv("convex");
    expect(env.convexUrl).toBe("https://convex.example.com");
    expect(env.convexSiteUrl).toBe("https://site.example.com");
  });

  test("cleanup guard names the canonical convex origin", async () => {
    delete process.env.E2E_CLEANUP_TOKEN;
    delete process.env.E2E_CONVEX_SITE_URL;
    const query = "?env-test=guard";
    const module: typeof import("./env") = await import(`./env${query}`);
    expect(() => module.requireE2ECleanup()).toThrow(
      "E2E_CLEANUP_TOKEN and E2E_CONVEX_SITE_URL are required"
    );
  });
});
