import { afterEach, describe, expect, mock, test } from "bun:test";

const originalDefaultDsn = process.env.SENTRY_DSN;
const originalApiDsn = process.env.SENTRY_API_DSN;
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.SENTRY_DSN = originalDefaultDsn;
  process.env.SENTRY_API_DSN = originalApiDsn;
  globalThis.fetch = originalFetch;
});

describe("sentry business events", () => {
  test("skips sending when business event dsn is missing", async () => {
    process.env.SENTRY_DSN = "";
    process.env.SENTRY_API_DSN = "";
    const { captureBusinessEvent } = await import("../sentry");
    const handler =
      (captureBusinessEvent as any).handler ?? captureBusinessEvent;

    const result = await handler({}, { event: "user.created" });

    expect(result).toEqual({ sent: false, reason: "missing_dsn" });
  });

  test("sends sanitized business event envelopes", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/123";

    let capturedBody = "";
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? "");
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const { captureBusinessEvent } = await import("../sentry");
    const handler =
      (captureBusinessEvent as any).handler ?? captureBusinessEvent;

    const result = await handler(
      {},
      {
        event: "card.created",
        userId: "user_123",
        cardId: "card_123",
        cardType: "link",
        surface: "api",
      }
    );

    expect(result).toEqual({ sent: true });
    expect(globalThis.fetch).toHaveBeenCalled();
    const [endpoint, init] = (
      globalThis.fetch as unknown as {
        mock: { calls: [string, RequestInit][] };
      }
    ).mock.calls[0];
    expect(endpoint).toBe("https://example.ingest.sentry.io/api/123/envelope/");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/x-sentry-envelope",
    });
    expect(capturedBody).toContain("teak.card.created");
    expect(capturedBody).toContain("\"surface\":\"api\"");
    expect(capturedBody).not.toContain("user_123");
    expect(capturedBody).not.toContain("card_123");
  });
});
