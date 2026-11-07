import { afterEach, describe, expect, mock, test } from "bun:test";
import worker, { type Env } from "./index";
import { TEST_SECRET as SECRET, signedOpRequest } from "./test/opsHarness";
import { withObjectGates } from "./test/testsupport";

const finalizeRequest = (sourceKey: string): Promise<Request> =>
  signedOpRequest("finalize-upload", {
    destinationKey: "users/9f8a/cards/c123/file/final.png",
    sourceKey,
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
    BUCKET: { get: () => Promise.reject(new Error("r2_unavailable")) },
    FILES_SIGNING_SECRET: SECRET,
    // A test fixture value ("phc_test" or none), not a real token.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    POSTHOG_PROJECT_TOKEN: token,
  }) as unknown as Env;
  const response = await worker.fetch(
    await finalizeRequest("users/9f8a/cards/c123/file/photo.png"),
    env_,
    { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as never
  );
  await Promise.all(pending);
  return { posthog, response, sent };
};

describe("core worker error reporting", () => {
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
          "files.op": "finalize-upload",
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
      BUCKET: { get: () => Promise.resolve(null) },
      FILES_SIGNING_SECRET: SECRET,
    }) as unknown as Env;
    const response = await worker.fetch(
      await finalizeRequest("users/9f8a/cards/c123/file/gone.png"),
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
