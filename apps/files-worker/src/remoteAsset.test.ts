import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import { FETCHER_HEADERS } from "../fetcher/src/protocol";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { FakeBucket, JPEG_BYTES } from "./testsupport";

const SECRET = "test-secret";
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
  const body = JSON.stringify({
    op: "store-remote-asset",
    params,
    version: FILES_PROTOCOL_VERSION,
  });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const response = await handleInternalOp(
    new Request("https://files.teakvault.com/__ops/v1", {
      body,
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
      method: "POST",
    }),
    {
      BUCKET: bucket as never,
      FILES_SIGNING_SECRET: SECRET,
      LINK_FETCHER: pool.namespace,
      LINK_FETCHER_INSTANCES: "2",
    } as FilesOpsEnv
  );
  return {
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; retryable: boolean };
    },
    bucket,
    calls: pool.calls,
    status: response.status,
  };
};

const imageResponse = () =>
  new Response(JPEG_BYTES, {
    headers: {
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

  test("keeps an SVG's fractional dimensions", async () => {
    const svg = new TextEncoder().encode("<svg/>");
    const { body, bucket } = await storeAsset(
      () =>
        new Response(svg, {
          headers: {
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
          headers: { [FETCHER_HEADERS.contentType]: "image/jpeg" },
        })
    );
    expect(status).toBe(503);
    expect(bucket.puts).toEqual([]);
  });

  test.each([
    { destinationKey: "users/u1/../u2/a", kind: "image", url: "https://a/b" },
    { destinationKey: "other/u1/a", kind: "image", url: "https://a/b" },
    { destinationKey: KEY, kind: "zip", url: "https://a/b" },
    { destinationKey: KEY, kind: "image", url: "" },
  ])("rejects invalid parameters %#", async (params) => {
    const { calls, status } = await storeAsset(imageResponse, params);
    expect(status).toBe(400);
    expect(calls).toEqual([]);
  });
});
