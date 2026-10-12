import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import worker, { type Env } from "./index";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { parseFileKeyIdentifiers } from "./telemetry";
import { withObjectGates } from "./testsupport";

const SECRET = "test-secret";

const signedOpRequest = async (sourceKey: string): Promise<Request> => {
  const body = JSON.stringify({
    op: "analyze-image",
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

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const failingOp = async (token?: string) => {
  const sent: unknown[] = [];
  const posthog = mock((_url: string, init: RequestInit) => {
    sent.push(...JSON.parse(String(init.body)).batch);
    return Promise.resolve(Response.json({ status: 1 }));
  });
  globalThis.fetch = posthog as unknown as typeof fetch;
  const pending: Promise<unknown>[] = [];
  const env_ = withObjectGates({
    // Image analysis's first R2 read rejects; nothing classifies this error,
    // so it lands on the console.error + report + 500 path.
    BUCKET: { get: () => Promise.reject(new Error("r2_unavailable")) },
    FILES_SIGNING_SECRET: SECRET,
    // A test fixture value ("phc_test" or none), not a real token.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    POSTHOG_PROJECT_TOKEN: token,
  }) as unknown as Env;
  const response = await worker.fetch(
    await signedOpRequest("users/9f8a/cards/c123/file/photo.png"),
    env_,
    { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as never
  );
  await Promise.all(pending);
  return { posthog, response, sent };
};

describe("files worker error reporting", () => {
  test("reports unexpected op failures after the handled 500", async () => {
    const { response, sent } = await failingOp("phc_test");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL", retryable: true },
      ok: false,
    });
    expect(sent).toMatchObject([
      {
        event: "$exception",
        properties: {
          $lib: "teak-files-worker",
          "card.id": "c123",
          "files.op": "analyze-image",
          "object.role": "file",
        },
      },
    ]);
  });

  test("sends nothing without a project token", async () => {
    const { posthog, response } = await failingOp();
    expect(response.status).toBe(500);
    expect(posthog).not.toHaveBeenCalled();
  });

  test("expected op rejections stay unreported client-style statuses", async () => {
    const env_ = withObjectGates({
      BUCKET: { head: () => Promise.resolve(null) },
      FILES_SIGNING_SECRET: SECRET,
    }) as unknown as Env;
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
