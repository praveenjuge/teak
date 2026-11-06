import { afterEach, describe, expect, test } from "bun:test";
import { runOp } from "./test/opsHarness";
import { FakeBucket } from "./test/testsupport";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const imageEnv = (run: () => unknown) => {
  const bucket = new FakeBucket();
  bucket.objects.set("users/u1/cards/c1/file/pic.png", {
    bytes: new Uint8Array([1]),
    httpMetadata: { contentType: "image/png" },
  });
  // The image's AI rendition, fetched through the Images transform.
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      })
    )) as unknown as typeof fetch;
  return { AI: { run }, BUCKET: bucket as unknown as R2Bucket };
};

describe("a Workers AI provider at capacity", () => {
  test.each([
    ["a 3040 message", () => new Error("3040: Capacity temporarily exceeded")],
    [
      "a 429 status",
      () => Object.assign(new Error("Too busy"), { status: 429 }),
    ],
  ])(
    "answers AI_CAPACITY for an image (%s), not an internal error",
    async (_name, error) => {
      let calls = 0;
      const { body, status } = await runOp(
        imageEnv(() => {
          calls += 1;
          throw error();
        }),
        "generate-image-metadata",
        { sourceKey: "users/u1/cards/c1/file/pic.png" }
      );
      expect(status).toBe(429);
      expect(body.error?.code).toBe("AI_CAPACITY");
      // The first call and its two capacity retries.
      expect(calls).toBe(3);
    }
  );

  test("answers AI_CAPACITY when reading an image's text", async () => {
    const { body, status } = await runOp(
      imageEnv(() => {
        throw new Error("3040: Capacity temporarily exceeded");
      }),
      "extract-image-text",
      { sourceKey: "users/u1/cards/c1/file/pic.png" }
    );
    expect(status).toBe(429);
    expect(body.error?.code).toBe("AI_CAPACITY");
  });

  test("a decision retries the same way before it answers", async () => {
    let calls = 0;
    const { body, status } = await runOp(
      {
        AI: {
          run: () => {
            calls += 1;
            throw Object.assign(new Error("busy"), { code: 3040 });
          },
        } as never,
      },
      "decide-card-type",
      { content: "Mint, sage and cream", rulesType: "text" }
    );
    expect(status).toBe(429);
    expect(body.error?.code).toBe("AI_CAPACITY");
    expect(calls).toBe(3);
  });
});

test("an op takes the AI usage it is attributed to beside its own params", async () => {
  const { body, status } = await runOp(
    {
      AI: {
        run: () => ({ response: '{"summary":"A note.","tags":["note"]}' }),
      } as never,
      CONVEX_SITE_URLS: "https://happy-otter-123.convex.site",
    } as never,
    "generate-text-metadata",
    {
      aiUsage: {
        convexSiteUrl: "https://happy-otter-123.convex.site",
        userId: "teak_u1",
      },
      prompt: "A note",
    }
  );
  expect(body.error).toBeUndefined();
  expect(status).toBe(200);
});

describe("object keys", () => {
  const INVALID_KEYS = ["", "../users/u1/a.png", "elsewhere/a.png"];

  test.each(INVALID_KEYS)("delete-object refuses %p", async (key) => {
    const bucket = new FakeBucket();
    bucket.objects.set("elsewhere/a.png", { bytes: new Uint8Array([1]) });
    const { body, status } = await runOp(
      { BUCKET: bucket as unknown as R2Bucket },
      "delete-object",
      { key }
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("INVALID_INPUT");
    expect(bucket.objects.has("elsewhere/a.png")).toBe(true);
  });

  test.each(INVALID_KEYS)("create-multipart refuses %p", async (key) => {
    const { body, status } = await runOp(
      { BUCKET: new FakeBucket() as unknown as R2Bucket },
      "create-multipart",
      { key }
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("INVALID_INPUT");
  });

  test("delete-object deletes a key in a user's folder", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u1/cards/c1/file/a.png", {
      bytes: new Uint8Array([1]),
    });
    const { body } = await runOp(
      { BUCKET: bucket as unknown as R2Bucket },
      "delete-object",
      { key: "users/u1/cards/c1/file/a.png" }
    );
    expect(body.data).toEqual({ deleted: true });
    expect(bucket.objects.size).toBe(0);
  });
});
