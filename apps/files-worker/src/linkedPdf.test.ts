import { describe, expect, test } from "bun:test";
import { parseLinkedPdfParams, storeLinkedPdf } from "./linkedPdf";
import { FakeBucket } from "./test/testsupport";

// Save PDF's download: arxiv.org only, a PDF only, up to 100 MiB, straight
// into R2, and never twice for one key.

const KEY = "users/u/cards/stored/file/abc-1706.03762.pdf";
const PDF = "https://arxiv.org/pdf/1706.03762";
const BYTES = new TextEncoder().encode("%PDF-1.7 tiny");

const pdf = (headers: Record<string, string> = {}) =>
  new Response(BYTES, {
    headers: {
      "content-length": String(BYTES.length),
      "content-type": "application/pdf",
      ...headers,
    },
  });

const network = (route: (url: string) => Response) => {
  const requests: Array<{ redirect?: string; url: string }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ redirect: init?.redirect, url });
    return Promise.resolve(route(url));
  }) as typeof fetch;
  return { fetcher, requests };
};

const store = (
  bucket: FakeBucket,
  fetcher: typeof fetch,
  params = { destinationKey: KEY, url: PDF }
) => storeLinkedPdf({ BUCKET: bucket as unknown as R2Bucket }, params, fetcher);

describe("parseLinkedPdfParams", () => {
  test("accepts an arXiv PDF and a user key", () => {
    expect(parseLinkedPdfParams({ destinationKey: KEY, url: PDF })).toEqual({
      destinationKey: KEY,
      url: PDF,
    });
  });

  test.each([
    { destinationKey: KEY, url: "https://evil.example/pdf/1706.03762" },
    { destinationKey: KEY, url: "https://arxiv.org/abs/1706.03762" },
    { destinationKey: KEY, url: "http://arxiv.org/pdf/1706.03762" },
    { destinationKey: KEY, url: "https://arxiv.org/pdf/1706.03762?redirect=x" },
    { destinationKey: "../other/key", url: PDF },
    { destinationKey: KEY },
  ])("refuses %o", (params: Record<string, unknown>) => {
    expect(() => parseLinkedPdfParams(params)).toThrow(
      "invalid_linked_pdf_params"
    );
  });
});

describe("storeLinkedPdf", () => {
  test("stores the PDF with its type", async () => {
    const bucket = new FakeBucket();
    const { fetcher, requests } = network(() => pdf());

    expect(await store(bucket, fetcher)).toEqual({
      contentType: "application/pdf",
      reused: false,
      size: BYTES.length,
      stored: true,
    });
    expect(requests).toEqual([{ redirect: "manual", url: PDF }]);
    expect(bucket.objects.get(KEY)?.bytes).toEqual(BYTES);
    expect(bucket.objects.get(KEY)?.httpMetadata).toEqual({
      contentType: "application/pdf",
    });
  });

  test("a PDF already stored is reused, not downloaded again", async () => {
    const bucket = new FakeBucket();
    await bucket.put(KEY, BYTES, {
      httpMetadata: { contentType: "application/pdf" },
    });
    const { fetcher, requests } = network(() => pdf());

    expect(await store(bucket, fetcher)).toMatchObject({
      reused: true,
      size: BYTES.length,
      stored: true,
    });
    expect(requests).toEqual([]);
  });

  test("follows a redirect within arXiv", async () => {
    const bucket = new FakeBucket();
    const { fetcher, requests } = network((url) =>
      url === PDF
        ? new Response(null, {
            status: 301,
            headers: { location: "https://export.arxiv.org/pdf/1706.03762v7" },
          })
        : pdf()
    );

    expect((await store(bucket, fetcher)).stored).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      PDF,
      "https://export.arxiv.org/pdf/1706.03762v7",
    ]);
  });

  test.each([
    "https://evil.example/paper.pdf",
    "http://arxiv.org/pdf/1706.03762",
    "https://169.254.169.254/latest/meta-data",
  ])("refuses a redirect to %s", async (location: string) => {
    const bucket = new FakeBucket();
    const { fetcher, requests } = network(
      () => new Response(null, { status: 302, headers: { location } })
    );

    expect(await store(bucket, fetcher)).toEqual({
      reason: "fetch_failed",
      status: 302,
      stored: false,
    });
    expect(requests).toHaveLength(1);
    expect(bucket.objects.size).toBe(0);
  });

  test("stops after three redirects", async () => {
    const { fetcher, requests } = network(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://arxiv.org/pdf/1706.03762" },
        })
    );

    expect((await store(new FakeBucket(), fetcher)).stored).toBe(false);
    expect(requests).toHaveLength(4);
  });

  test.each([
    [
      "an HTML page",
      () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
      "unsupported_type",
    ],
    [
      "200 MB",
      () => pdf({ "content-length": String(200 * 1024 * 1024) }),
      "too_large",
    ],
    ["no length", () => pdf({ "content-length": "" }), "fetch_failed"],
    ["a 404", () => new Response("gone", { status: 404 }), "http_error"],
  ])("%s is not stored", async (_name, respond, reason) => {
    const bucket = new FakeBucket();
    const { fetcher } = network(respond);

    expect(await store(bucket, fetcher)).toMatchObject({
      reason,
      stored: false,
    });
    expect(bucket.objects.size).toBe(0);
  });

  test("a network failure is not stored", async () => {
    const fetcher = (() =>
      Promise.reject(new Error("connection reset"))) as unknown as typeof fetch;

    expect(await store(new FakeBucket(), fetcher)).toEqual({
      reason: "fetch_failed",
      stored: false,
    });
  });
});
