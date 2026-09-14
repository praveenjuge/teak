import { afterEach, describe, expect, test } from "bun:test";

const NAMES = [
  "SITE_URL",
  "JWKS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
  "APPLE_TEAM_ID",
  "APPLE_APP_BUNDLE_IDENTIFIER",
];

const saved = new Map(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) {
    const value = saved.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("convex env capability groups", () => {
  test("readSiteUrl requires and normalizes SITE_URL", async () => {
    const { readSiteUrl } = await import("../env");
    delete process.env.SITE_URL;
    expect(() => readSiteUrl()).toThrow(
      "SITE_URL environment variable is required"
    );
    process.env.SITE_URL = "not-a-url";
    expect(() => readSiteUrl()).toThrow("not a valid URL");
    process.env.SITE_URL = "https://app.teakvault.com/";
    expect(readSiteUrl()).toBe("https://app.teakvault.com");
  });

  test("google group resolves when paired and vanishes when absent", async () => {
    const { getGoogleCredentials } = await import("../env");
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(getGoogleCredentials()).toBeUndefined();
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(getGoogleCredentials()).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  test("google group rejects a lone id or secret", async () => {
    const { getGoogleCredentials } = await import("../env");
    process.env.GOOGLE_CLIENT_ID = "id";
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => getGoogleCredentials()).toThrow("GOOGLE_CLIENT_SECRET");
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(() => getGoogleCredentials()).toThrow("GOOGLE_CLIENT_ID");
  });

  test("apple group resolves when complete and vanishes when absent", async () => {
    const { getAppleCredentials } = await import("../env");
    for (const name of NAMES.filter((name) => name.startsWith("APPLE_"))) {
      delete process.env[name];
    }
    expect(getAppleCredentials()).toBeUndefined();
    process.env.APPLE_CLIENT_ID = "client";
    process.env.APPLE_KEY_ID = "key";
    process.env.APPLE_PRIVATE_KEY = "private";
    process.env.APPLE_TEAM_ID = "team";
    expect(getAppleCredentials()).toMatchObject({
      clientId: "client",
      keyId: "key",
    });
  });

  test("apple group names every missing variable when partial", async () => {
    const { getAppleCredentials } = await import("../env");
    for (const name of NAMES.filter((name) => name.startsWith("APPLE_"))) {
      delete process.env[name];
    }
    process.env.APPLE_CLIENT_ID = "client";
    expect(() => getAppleCredentials()).toThrow("APPLE_KEY_ID");
    expect(() => getAppleCredentials()).toThrow("APPLE_PRIVATE_KEY");
    expect(() => getAppleCredentials()).toThrow("APPLE_TEAM_ID");
  });

  test("jwks document vanishes when unset or JSON-falsy", async () => {
    const { readJwksDocument } = await import("../env");
    delete process.env.JWKS;
    expect(readJwksDocument()).toBeUndefined();
    process.env.JWKS = "";
    expect(readJwksDocument()).toBeUndefined();
    for (const sentinel of ["null", "false", "0", '""', "  null  "]) {
      process.env.JWKS = sentinel;
      expect(readJwksDocument()).toBeUndefined();
    }
  });

  test("jwks document passes an exported document through verbatim", async () => {
    const { readJwksDocument } = await import("../env");
    const doc = '[{"id":"k1","publicKey":"{}","privateKey":"{}"}]';
    process.env.JWKS = doc;
    expect(readJwksDocument()).toBe(doc);
  });

  test("jwks document rejects invalid JSON", async () => {
    const { readJwksDocument } = await import("../env");
    process.env.JWKS = "not-json{";
    expect(() => readJwksDocument()).toThrow("not valid JSON");
  });
});
