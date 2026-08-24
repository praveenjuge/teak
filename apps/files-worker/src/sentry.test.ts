import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import worker, { type Env } from "./index";
import { hmacSha256Hex, sha256Hex } from "./lib";
import {
  parseFileKeyIdentifiers,
  reportFilesOpFailure,
  resolveSentryOptions,
} from "./sentry";

const SECRET = "test-secret";

const signedOpRequest = async (sourceKey: string): Promise<Request> => {
  const body = JSON.stringify({
    op: "process-image",
    params: { sourceKey },
    version: FILES_PROTOCOL_VERSION,
  });
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const requestId = crypto.randomUUID();
  return new Request("https://files.teakvault.com/__ops/v1", {
    body,
    method: "POST",
    headers: {
      "x-teak-expires-at": expiresAt,
      "x-teak-request-id": requestId,
      "x-teak-signature": await hmacSha256Hex(
        SECRET,
        buildFilesOpSigningPayload({
          bodySha256: await sha256Hex(body),
          expiresAt,
          requestId,
        })
      ),
    },
  });
};

describe("resolveSentryOptions", () => {
  test("stays disabled without a DSN (tests, local dev, secret unset)", () => {
    expect(resolveSentryOptions({})).toBeUndefined();
    expect(resolveSentryOptions({ SENTRY_DSN: "   " })).toBeUndefined();
  });

  test("resolves a trimmed DSN without extra fields", () => {
    expect(
      resolveSentryOptions({ SENTRY_DSN: " https://k@example.invalid/1 " })
    ).toEqual({
      dsn: "https://k@example.invalid/1",
      sendDefaultPii: false,
    });
  });

  test("passes optional environment/release overrides through", () => {
    expect(
      resolveSentryOptions({
        SENTRY_DSN: "https://k@example.invalid/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "teak-files-worker@1.0.64+abcdef0",
      })
    ).toEqual({
      dsn: "https://k@example.invalid/1",
      environment: "production",
      release: "teak-files-worker@1.0.64+abcdef0",
      sendDefaultPii: false,
    });
  });

  test("never enables default PII", () => {
    const resolved = [
      resolveSentryOptions({ SENTRY_DSN: "https://k@example.invalid/1" }),
      resolveSentryOptions({
        SENTRY_DSN: "https://k@example.invalid/1",
        SENTRY_RELEASE: "r",
      }),
    ];
    expect(resolved).not.toContain(undefined);
    for (const options of resolved) {
      expect(options?.sendDefaultPii).toBe(false);
    }
  });
});

describe("parseFileKeyIdentifiers", () => {
  test("extracts card id and role from buildR2ObjectKey-shaped keys", () => {
    expect(
      parseFileKeyIdentifiers(
        "users/9f8a/cards/c123/file/00000000-0000-4000-8000-000000000000-photo.png"
      )
    ).toEqual({ cardId: "c123", role: "file" });
    expect(
      parseFileKeyIdentifiers("users/9f8a/cards/c123/thumbnail/t.webp")
    ).toEqual({ cardId: "c123", role: "thumbnail" });
  });

  test("omits pending-upload and unknown identifiers instead of guessing", () => {
    expect(
      parseFileKeyIdentifiers("users/9f8a/cards/pending/file/x.png")
    ).toEqual({ role: "file" });
    expect(parseFileKeyIdentifiers("some/other/key.png")).toEqual({});
    expect(parseFileKeyIdentifiers("")).toEqual({});
  });
});

describe("reportFilesOpFailure", () => {
  test("is a safe no-op while the SDK is uninitialized", () => {
    expect(() =>
      reportFilesOpFailure("process-image", new Error("wasm compile failed"), {
        httpMethod: "get",
        httpPath: "/users/9f8a/cards/c123/file/photo.png",
        objectKey: "users/9f8a/cards/c123/file/photo.png",
      })
    ).not.toThrow();
    expect(() =>
      reportFilesOpFailure("inspect", "not-an-error-instance", {
        httpMethod: "GET",
        httpPath: "/x",
        objectKey: "",
      })
    ).not.toThrow();
  });
});

describe("files worker error reporting", () => {
  test("unexpected op failures still return the handled 500 with Sentry wired", async () => {
    const env_ = {
      // processImage's first R2 read rejects; nothing classifies this error,
      // so it lands on the console.error + captureException + 500 path.
      BUCKET: { get: () => Promise.reject(new Error("r2_unavailable")) },
      FILES_SIGNING_SECRET: SECRET,
    } as unknown as Env;
    const response = await worker.fetch(
      await signedOpRequest("users/9f8a/cards/c123/file/photo.png"),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL", retryable: true },
      ok: false,
    });
  });

  test("expected op rejections stay unreported client-style statuses", async () => {
    const env_ = {
      BUCKET: { get: () => Promise.resolve(null) },
      FILES_SIGNING_SECRET: SECRET,
    } as unknown as Env;
    const response = await worker.fetch(
      await signedOpRequest("users/9f8a/cards/c123/file/gone.png"),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", retryable: false },
      ok: false,
    });
  });
});
