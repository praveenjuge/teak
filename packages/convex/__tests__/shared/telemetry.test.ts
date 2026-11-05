import { describe, expect, test } from "bun:test";
import {
  normalizeErrorClass,
  normalizeTelemetryAttributes,
  resolveTelemetryEnvironment,
  scrubTelemetryString,
  scrubTelemetryValue,
} from "../../shared/telemetry";

describe("telemetry environment", () => {
  test("normalizes deployment environments to the locked vocabulary", () => {
    expect(resolveTelemetryEnvironment({ explicit: "vercel-production" })).toBe(
      "production"
    );
    expect(resolveTelemetryEnvironment({ explicit: "prod" })).toBe(
      "production"
    );
    expect(resolveTelemetryEnvironment({ vercelEnvironment: "preview" })).toBe(
      "preview"
    );
    expect(resolveTelemetryEnvironment({ nodeEnvironment: "test" })).toBe(
      "test"
    );
    expect(resolveTelemetryEnvironment({ nodeEnvironment: "local" })).toBe(
      "development"
    );
  });
});

describe("telemetry privacy and bounds", () => {
  test("scrubs credentials, emails, binary data, and signed urls", () => {
    const value = [
      "Authorization: Bearer secret.token.value",
      '"session":"session-secret"',
      "CLOUDFLARE_API_TOKEN=cf-secret",
      "owner@example.com",
      "https://bucket.example/file?X-Amz-Signature=secret&X-Amz-Expires=60",
      "data:image/png;base64,AAAAAA==",
    ].join("\n");
    const scrubbed = scrubTelemetryString(value);

    expect(scrubbed).not.toContain("secret.token.value");
    expect(scrubbed).not.toContain("session-secret");
    expect(scrubbed).not.toContain("cf-secret");
    expect(scrubbed).not.toContain("owner@example.com");
    expect(scrubbed).not.toContain("X-Amz-Signature");
    expect(scrubbed).not.toContain("AAAAAA");
    expect(scrubbed).toContain("[REDACTED_SIGNED_URL]");
  });

  test("scrubs credentials recognisable by shape and credential header lines", () => {
    const teakKey = `teakapi_secret_prod_ab12cd34_${"0f".repeat(32)}`;
    const cases = {
      apiKeyUrl: "GET https://api.example/v1?plan=pro&key=AIzaFake1234567890",
      basic: "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      cookie: "Cookie: wos-session=cookie-secret-value; theme=dark",
      jwt: "rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl",
      oauthCode: "fetch https://app.example/callback?code=oauth-code-value",
      sealed: "session Fe26.2**sealed-session-value*expires",
      setCookie: "set-cookie: session=cookie-secret-value; Path=/",
      teakKey: `Invalid key ${teakKey} for request`,
      workos: "WorkOS key sk_test_a1b2c3d4e5f6g7h8i9j0 was rejected",
    };
    const scrubbed = Object.fromEntries(
      Object.entries(cases).map(([name, value]) => [
        name,
        scrubTelemetryString(value),
      ])
    );
    const leaks = [
      "AIzaFake",
      "dXNlcjpwYXNzd29yZA",
      "cookie-secret-value",
      "eyJhbGciOiJIUzI1NiJ9",
      "oauth-code-value",
      "sealed-session-value",
      teakKey.slice(-16),
      "a1b2c3d4e5f6g7h8i9j0",
    ];
    const joined = Object.values(scrubbed).join("\n");
    for (const leak of leaks) {
      expect(joined).not.toContain(leak);
    }
    expect(scrubbed.basic).toBe("Authorization: [REDACTED]");
    expect(scrubbed.teakKey).toBe("Invalid key [REDACTED_API_KEY] for request");
    expect(scrubbed.jwt).toBe("rejected [REDACTED_JWT]");
  });

  test("keeps ordinary text, URLs and token counts readable", () => {
    const plain =
      "Card processing failed at https://example.com/post?id=7 after 42 tokens";
    expect(scrubTelemetryString(plain)).toBe(plain);
  });

  test("scrubs private keys without backtracking on repeated headers", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "sensitive-key-material",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const adversarial = "-----BEGIN PRIVATE KEY-----".repeat(10_000);

    expect(scrubTelemetryString(privateKey)).toBe("[REDACTED_PRIVATE_KEY]");
    expect(scrubTelemetryString(adversarial)).not.toContain(
      "-----BEGIN PRIVATE KEY-----"
    );
  });

  test("scrubs truncated and nested private-key blocks", () => {
    const truncated = [
      "before",
      "-----BEGIN PRIVATE KEY-----",
      "sensitive-key-material",
    ].join("\n");
    const nested = [
      "-----BEGIN PRIVATE KEY-----",
      "first-sensitive-value",
      "-----BEGIN PRIVATE KEY-----",
      "second-sensitive-value",
    ].join("\n");

    expect(scrubTelemetryString(truncated)).toBe(
      "before\n[REDACTED_PRIVATE_KEY]"
    );
    expect(scrubTelemetryString(nested)).not.toContain("sensitive-value");
    expect(scrubTelemetryString(nested)).not.toContain("PRIVATE KEY");
  });

  test("drops non-finite values and invalid keys", () => {
    expect(
      normalizeTelemetryAttributes({
        "duration.ms": Number.NaN,
        "valid.key": 12,
        "UPPER.KEY": "drop",
      })
    ).toEqual({ "valid.key": 12 });
  });
});

describe("telemetry error classes and values", () => {
  test("normalizes error classes without emitting messages", () => {
    expect(
      normalizeErrorClass(new Error("Workers AI generation rejected"))
    ).toBe("ProviderError");
    expect(normalizeErrorClass(new Error("Request timed out"))).toBe(
      "TimeoutError"
    );
    expect(normalizeErrorClass("unexpected")).toBe("UnknownError");
  });

  test("scrubs credential values by key without hiding token counts", () => {
    expect(
      scrubTelemetryValue({
        access_token: "sensitive",
        sessionToken: "sensitive",
        token: "sensitive",
        tokens: 42,
      })
    ).toEqual({
      access_token: "[REDACTED]",
      sessionToken: "[REDACTED]",
      token: "[REDACTED]",
      tokens: 42,
    });
  });
});
