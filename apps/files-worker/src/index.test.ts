import { describe, expect, test } from "bun:test";
import worker, { type Env } from "./index";
import { buildSigningPayload, hmacSha256Hex } from "./lib";
import {
  FakeBucket,
  fakeHttpEtag,
  makePng,
} from "./testsupport";

const SECRET = "test-secret";

const env = (): Env =>
  ({
    BUCKET: new FakeBucket() as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
  }) as Env;

const signedUrl = async (
  path: string,
  params: Record<string, string> = {},
  expSecondsFromNow = 3600
): Promise<string> => {
  const url = new URL(`https://files.teakvault.com${path}`);
  const key = decodeURIComponent(path.replace(/^\/+/, ""));
  const exp = String(Math.floor(Date.now() / 1000) + expSecondsFromNow);
  const sig = await hmacSha256Hex(
    SECRET,
    buildSigningPayload({
      key,
      exp,
      contentType: params.ct ?? "",
      contentDisposition: params.cd ?? "",
    })
  );
  url.searchParams.set("exp", exp);
  url.searchParams.set("sig", sig);
  if (params.ct) {
    url.searchParams.set("ct", params.ct);
  }
  if (params.cd) {
    url.searchParams.set("cd", params.cd);
  }
  return url.toString();
};

describe("files worker handler", () => {
  const seed = (env_: Env): void => {
    (env_.BUCKET as unknown as FakeBucket).objects.set(
      "users/u1/cards/f/x.png",
      {
        bytes: makePng(32, 32),
        httpMetadata: { contentType: "image/png" },
      }
    );
  };

  test("serves /__health without authentication", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/__health"),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("rejects non-GET/HEAD methods and answers OPTIONS preflights", async () => {
    const ctx = { waitUntil: () => undefined } as never;
    const post = await worker.fetch(
      new Request("https://files.teakvault.com/x", { method: "POST" }),
      env(),
      ctx
    );
    expect(post.status).toBe(405);

    const options = await worker.fetch(
      new Request("https://files.teakvault.com/x", { method: "OPTIONS" }),
      env(),
      ctx
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("rejects unsigned downloads", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/users/u1/cards/f/x.png"),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(401);
  });

  test("serves signed downloads with nosniff, length, etag, and CORS", async () => {
    const env_ = env();
    seed(env_);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png")),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    expect(response.headers.get("etag")).toBe(fakeHttpEtag(makePng(32, 32)));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("private");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(makePng(32, 32).length);
  });

  test("answers conditional requests with a bodyless 304", async () => {
    const env_ = env();
    seed(env_);
    const etag = fakeHttpEtag(makePng(32, 32));
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        headers: { "if-none-match": `"${etag.replace(/"/g, "")}"` },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  test("supports HEAD with identical headers and no body", async () => {
    const env_ = env();
    seed(env_);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        method: "HEAD",
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Number(response.headers.get("content-length"))).toBe(
      makePng(32, 32).length
    );
    expect(await response.text()).toBe("");
  });

  test("serves exact ranged responses for seeking", async () => {
    const env_ = env();
    seed(env_);
    const bytes = makePng(32, 32);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        headers: { range: `bytes=4-${String(11)}` },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 4-11/${String(bytes.length)}`
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes.slice(4, 12)
    );
  });

  test("rejects out-of-bounds ranges with a proper 416", async () => {
    const env_ = env();
    seed(env_);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        headers: { range: "bytes=99999-" },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(416);
  });
});
