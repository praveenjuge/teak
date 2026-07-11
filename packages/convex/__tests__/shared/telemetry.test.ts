import { describe, expect, test } from "bun:test";
import {
  buildBackendRelease,
  buildDesktopRelease,
  buildMobileRelease,
  buildTelemetryContext,
  buildWebRelease,
  normalizeErrorClass,
  normalizeTelemetryAttributes,
  prepareTelemetryContent,
  resolveTelemetryEnvironment,
  resolveTraceSampleRate,
  scrubTelemetryString,
  scrubTelemetryValue,
  TELEMETRY_METRICS,
  TELEMETRY_OPERATIONS,
} from "../../shared/telemetry";

describe("telemetry environment and releases", () => {
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

  test("builds surface-specific releases", () => {
    const sha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    expect(buildWebRelease("v1.2.3", sha)).toBe(
      "teak-web@1.2.3+abcdef0123456789abcdef0123456789abcdef01"
    );
    expect(buildDesktopRelease("1.2.3", sha)).toBe(
      "teak-desktop@1.2.3+abcdef0123456789abcdef0123456789abcdef01"
    );
    expect(buildMobileRelease("1.2.3", "42")).toBe("teak-mobile@1.2.3+42");
    expect(buildBackendRelease(sha)).toBe(
      "teak-backend@abcdef0123456789abcdef0123456789abcdef01"
    );
  });

  test("requires both binary coordinates for client releases", () => {
    expect(buildWebRelease("1.2.3", undefined)).toBeUndefined();
    expect(buildMobileRelease("1.2.3", undefined)).toBeUndefined();
    expect(buildBackendRelease("not-a-sha")).toBeUndefined();
  });
});

describe("telemetry privacy and bounds", () => {
  test("scrubs credentials, emails, binary data, and signed urls", () => {
    const value = [
      "Authorization: Bearer secret.token.value",
      '"session":"session-secret"',
      "GROQ_API_KEY=groq-secret",
      "owner@example.com",
      "https://bucket.example/file?X-Amz-Signature=secret&X-Amz-Expires=60",
      "data:image/png;base64,AAAAAA==",
    ].join("\n");
    const scrubbed = scrubTelemetryString(value);

    expect(scrubbed).not.toContain("secret.token.value");
    expect(scrubbed).not.toContain("session-secret");
    expect(scrubbed).not.toContain("groq-secret");
    expect(scrubbed).not.toContain("owner@example.com");
    expect(scrubbed).not.toContain("X-Amz-Signature");
    expect(scrubbed).not.toContain("AAAAAA");
    expect(scrubbed).toContain("[REDACTED_SIGNED_URL]");
  });

  test("scrubs private keys without backtracking on repeated headers", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "sensitive-key-material",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const adversarial = "-----BEGIN PRIVATE KEY-----".repeat(10_000);

    expect(scrubTelemetryString(privateKey)).toBe("[REDACTED_PRIVATE_KEY]");
    expect(scrubTelemetryString(adversarial)).toBe(adversarial);
  });

  test("retains an allowed prefix and suffix for oversized content", async () => {
    const raw = `${"a".repeat(90)}TOKEN=secret\n${"z".repeat(90)}`;
    const prepared = await prepareTelemetryContent(raw, 100);

    expect(prepared.truncated).toBe(true);
    expect(prepared.originalLength).toBe(raw.length);
    expect(prepared.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.content.startsWith("a")).toBe(true);
    expect(prepared.content.endsWith("z")).toBe(true);
    expect(prepared.content).not.toContain("secret");
    expect(prepared.content.length).toBeLessThanOrEqual(100);
  });

  test("hashes identifiers and bounds safe attributes", async () => {
    const context = await buildTelemetryContext({
      attributes: {
        "card.type": "link",
        invalidKey: "ok",
        "unsafe key": "drop",
        provider: "x".repeat(400),
      },
      cardId: "card-123",
      operation: TELEMETRY_OPERATIONS.workflow,
      surface: "backend",
      userId: "user-123",
      workflowId: "workflow-123",
    });

    expect(context.cardIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(context.userIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(context.workflowIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(context)).not.toContain("card-123");
    expect(JSON.stringify(context)).not.toContain("user-123");
    expect(context.attributes["unsafe key"]).toBeUndefined();
    expect(String(context.attributes.provider)).toHaveLength(256);
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

describe("telemetry naming and sampling", () => {
  test("keeps metric names unique and namespaced", () => {
    const names = Object.values(TELEMETRY_METRICS);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith("teak."))).toBe(true);
    expect(names).not.toContain("card.created");
    expect(TELEMETRY_METRICS.portalAttempt).toBe("teak.billing.portal.attempt");
  });

  test("keeps high-value production traces and samples routine navigation", () => {
    expect(
      resolveTraceSampleRate({
        environment: "production",
        operation: "navigation",
      })
    ).toBe(0.2);
    expect(
      resolveTraceSampleRate({
        environment: "production",
        operation: "storage.upload",
      })
    ).toBe(1);
    expect(
      resolveTraceSampleRate({
        environment: "production",
        operation: "navigation",
        outcome: "failure",
      })
    ).toBe(1);
    expect(
      resolveTraceSampleRate({
        durationMs: 2500,
        environment: "production",
        operation: "navigation",
      })
    ).toBe(1);
    expect(
      resolveTraceSampleRate({
        environment: "preview",
        operation: "navigation",
      })
    ).toBe(1);
  });

  test("normalizes error classes without emitting messages", () => {
    expect(normalizeErrorClass(new Error("Groq generation rejected"))).toBe(
      "ProviderError"
    );
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
