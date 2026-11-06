import { describe, expect, test } from "bun:test";
import { FETCHER_HEADERS } from "../../fetcher/src/protocol";
import { runOp } from "../test/opsHarness";
import { FakeBucket, JPEG_BYTES } from "../test/testsupport";

const _SECRET = "test-secret";
const KEY = "users/u1/cards/c1/link-preview-image/abc";

interface FetcherCall {
  body: Record<string, unknown>;
  instance: string;
}

const fetcherPool = (answer: (call: FetcherCall) => Response) => {
  const calls: FetcherCall[] = [];
  const namespace = {
    get: (instance: string) => ({
      fetch: async (request: Request) => {
        const call = { body: await request.json(), instance };
        calls.push(call);
        return answer(call);
      },
    }),
    idFromName: (name: string) => name,
  };
  return { calls, namespace: namespace as unknown as DurableObjectNamespace };
};

const storeAsset = async (
  answer: (call: FetcherCall) => Response,
  params: Record<string, unknown> = {
    destinationKey: KEY,
    kind: "image",
    url: "https://cdn.example/a.jpg",
  }
) => {
  const bucket = new FakeBucket();
  const pool = fetcherPool(answer);
  const { body, status } = await runOp(
    {
      BUCKET: bucket as never,
      LINK_FETCHER: pool.namespace,
      LINK_FETCHER_INSTANCES: "2",
    },
    "store-remote-asset",
    params
  );
  return { body, bucket, calls: pool.calls, status };
};

const imageResponse = () =>
  new Response(JPEG_BYTES, {
    headers: {
      "content-length": String(JPEG_BYTES.byteLength),
      [FETCHER_HEADERS.contentType]: "image/jpeg",
      [FETCHER_HEADERS.height]: "1",
      [FETCHER_HEADERS.width]: "2",
    },
  });

describe("store-remote-asset", () => {
  test("stores the fetched image in R2 under the given key", async () => {
    const { body, bucket, calls } = await storeAsset(imageResponse);
    expect(body.data).toEqual({
      contentType: "image/jpeg",
      height: 1,
      size: JPEG_BYTES.byteLength,
      stored: true,
      width: 2,
    });
    expect(bucket.puts).toEqual([
      {
        bytes: JPEG_BYTES,
        httpMetadata: { contentType: "image/jpeg" },
        key: KEY,
      },
    ]);
    expect(calls.map((call) => call.body)).toEqual([
      { kind: "image", url: "https://cdn.example/a.jpg" },
    ]);
  });

  test("passes the page URL on to the fetcher", async () => {
    const pageUrl = "https://www.figma.com/community/file/1234/kit";
    const { body, calls } = await storeAsset(imageResponse, {
      destinationKey: KEY,
      kind: "image",
      pageUrl,
      url: "https://s3-alpha.figma.com/hub/file/1234/cover.png",
    });
    expect(body.data).toMatchObject({ stored: true });
    expect(calls.map((call) => call.body)).toEqual([
      {
        kind: "image",
        pageUrl,
        url: "https://s3-alpha.figma.com/hub/file/1234/cover.png",
      },
    ]);
  });

  test("keeps an SVG's fractional dimensions", async () => {
    const svg = new TextEncoder().encode("<svg/>");
    const { body, bucket } = await storeAsset(
      () =>
        new Response(svg, {
          headers: {
            "content-length": String(svg.byteLength),
            [FETCHER_HEADERS.contentType]: "image/svg+xml",
            [FETCHER_HEADERS.height]: "20.46348",
            [FETCHER_HEADERS.width]: "23",
          },
        })
    );
    expect(body.data).toMatchObject({
      contentType: "image/svg+xml",
      height: 20.463_48,
      stored: true,
      width: 23,
    });
    expect(bucket.puts.map((put) => put.key)).toEqual([KEY]);
  });

  test("returns the fetcher's skip reason and stores nothing", async () => {
    const { body, bucket } = await storeAsset(() =>
      Response.json(
        { error: "skipped", reason: "http_error", status: 403 },
        { status: 422 }
      )
    );
    expect(body.data).toEqual({
      reason: "http_error",
      status: 403,
      stored: false,
    });
    expect(bucket.puts).toEqual([]);
  });

  test("moves on to the next instance when one is busy", async () => {
    let first = true;
    const { body, calls } = await storeAsset(() => {
      if (first) {
        first = false;
        return Response.json({ error: "busy" }, { status: 503 });
      }
      return imageResponse();
    });
    expect(body.data).toMatchObject({ stored: true });
    expect(new Set(calls.map((call) => call.instance)).size).toBe(2);
  });

  test("reports a retryable outage when every instance is busy", async () => {
    const { body, bucket, status } = await storeAsset(() =>
      Response.json({ error: "busy" }, { status: 503 })
    );
    expect(status).toBe(503);
    expect(body.error).toMatchObject({
      code: "RENDERER_UNAVAILABLE",
      retryable: true,
    });
    expect(bucket.puts).toEqual([]);
  });

  test("refuses an image the fetcher returned without dimensions", async () => {
    const { bucket, status } = await storeAsset(
      () =>
        new Response(JPEG_BYTES, {
          headers: {
            "content-length": String(JPEG_BYTES.byteLength),
            [FETCHER_HEADERS.contentType]: "image/jpeg",
          },
        })
    );
    expect(status).toBe(503);
    expect(bucket.puts).toEqual([]);
  });

  test.each([
    ["no declared length", {}],
    [
      "a declared length over the video limit",
      { "content-length": String(51 * 1024 * 1024) },
    ],
  ])("refuses a response with %s and stores nothing", async (_name, extra) => {
    const { bucket, status } = await storeAsset(
      () =>
        new Response(new Uint8Array([0, 0, 0, 24]), {
          headers: { [FETCHER_HEADERS.contentType]: "video/mp4", ...extra },
        }),
      {
        destinationKey: KEY,
        kind: "video",
        url: "https://cdn.example/v.mp4",
      }
    );
    expect(status).toBe(503);
    expect(bucket.puts).toEqual([]);
  });

  test.each([
    { destinationKey: "users/u1/../u2/a", kind: "image", url: "https://a/b" },
    { destinationKey: "other/u1/a", kind: "image", url: "https://a/b" },
    { destinationKey: KEY, kind: "zip", url: "https://a/b" },
    { destinationKey: KEY, kind: "image", url: "" },
    {
      destinationKey: KEY,
      kind: "image",
      pageUrl: "file:///etc",
      url: "https://a/b",
    },
    { destinationKey: KEY, kind: "image", pageUrl: "", url: "https://a/b" },
    {
      destinationKey: KEY,
      kind: "image",
      pageUrl: ["https://a"],
      url: "https://a/b",
    },
    {
      destinationKey: KEY,
      kind: "image",
      pageUrl: `https://a/${"a".repeat(5000)}`,
      url: "https://a/b",
    },
  ])("rejects invalid parameters %#", async (params) => {
    const { calls, status } = await storeAsset(imageResponse, params);
    expect(status).toBe(400);
    expect(calls).toEqual([]);
  });
});
