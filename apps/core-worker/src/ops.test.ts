import { describe, expect, test } from "bun:test";
import { FILES_PROTOCOL_VERSION } from "@teak/files-protocol";
import { type FilesOpsEnv, getFilesOpObjectKey, runFilesOp } from "./ops";
import { FakeBucket } from "./test/testsupport";

describe("getFilesOpObjectKey", () => {
  test.each([
    [{ key: "users/u/cards/c/file/a.png" }, "users/u/cards/c/file/a.png"],
    [{ sourceKey: "source.zip" }, "source.zip"],
    [{ archiveKey: "archive.zip" }, "archive.zip"],
    [{ artifactKey: "export.zip" }, "export.zip"],
    [{ manifestKey: "manifest.json" }, "manifest.json"],
    [{ keys: ["first.png", "second.png"] }, "first.png"],
    [{ artifactKey: "export.zip", manifestKey: "manifest.json" }, "export.zip"],
    [{ key: 42, keys: ["first.png"] }, "first.png"],
    [{}, ""],
    [[], ""],
    [null, ""],
    [undefined, ""],
  ] as const)("extracts %p", (params, expected) => {
    expect(getFilesOpObjectKey(params)).toBe(expected);
  });
});

describe("archive-page", () => {
  const DESTINATION = "users/u1/cards/c1/page-archive/r1-archive.html";
  const SNAPSHOT = "users/u1/cards/upload-pending-v2/page-snapshot/s1";
  const PAGE_URL = "https://site.example/post";

  const gzip = async (text: string | Uint8Array) =>
    new Uint8Array(
      await new Response(
        new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
      ).arrayBuffer()
    );

  const fetcherAnswering = (html: string, status = 200) => {
    const paths: string[] = [];
    const namespace = {
      get: () => ({
        fetch: (request: Request) => {
          paths.push(new URL(request.url).pathname);
          return Promise.resolve(
            status === 200
              ? Response.json({
                  cacheable: false,
                  charset: "utf-8",
                  html,
                  pageUrl: PAGE_URL,
                  selectors: [],
                })
              : Response.json(
                  { error: "blocked", reason: "blocked_url" },
                  { status }
                )
          );
        },
      }),
      idFromName: (name: string) => name,
    } as unknown as DurableObjectNamespace;
    return { namespace, paths };
  };

  const runArchiveOp = async (
    params: Record<string, unknown>,
    options: {
      fetcher?: ReturnType<typeof fetcherAnswering>;
      seed?: Record<string, Uint8Array>;
    } = {}
  ) => {
    const bucket = new FakeBucket();
    for (const [key, bytes] of Object.entries(options.seed ?? {})) {
      bucket.objects.set(key, { bytes });
    }
    const fetcher =
      options.fetcher ?? fetcherAnswering("<p>From the server</p>");
    const response = await runFilesOp(
      {
        BUCKET: bucket as unknown as R2Bucket,
        FILES_SIGNING_SECRET: "secret",
        LINK_FETCHER: fetcher.namespace,
        LINK_FETCHER_INSTANCES: "1",
      } as FilesOpsEnv,
      "request-1",
      {
        op: "archive-page",
        params: {
          capturedAt: 1,
          destinationKey: DESTINATION,
          url: PAGE_URL,
          ...params,
        },
        version: FILES_PROTOCOL_VERSION,
      },
      "https://files.teakvault.com"
    );
    const body = (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; message: string };
    };
    const written = bucket.objects.get(DESTINATION);
    return {
      body,
      fetcher,
      status: response.status,
      written: written
        ? {
            contentType: written.httpMetadata?.contentType,
            text: new TextDecoder().decode(written.bytes),
          }
        : null,
    };
  };

  test("archives the extension's snapshot without fetching the page", async () => {
    const result = await runArchiveOp(
      { snapshotKey: SNAPSHOT },
      {
        seed: {
          [SNAPSHOT]: await gzip(
            `<html><head><base href="${PAGE_URL}?seen"></head><body><p>As the browser showed it</p><script>x()</script></body></html>`
          ),
        },
      }
    );
    expect(result.body.data).toMatchObject({
      kind: "full",
      pageUrl: `${PAGE_URL}?seen`,
      source: "extension",
      storageKey: DESTINATION,
      stored: true,
    });
    expect(result.fetcher.paths).toEqual([]);
    expect(result.written?.contentType).toBe("text/html; charset=utf-8");
    expect(result.written?.text).toContain("As the browser showed it");
    expect(result.written?.text).not.toContain("<script");
  });

  test("without a snapshot, archives the page Teak fetches", async () => {
    const result = await runArchiveOp({});
    expect(result.body.data).toMatchObject({
      source: "server",
      stored: true,
    });
    expect(result.fetcher.paths).toEqual(["/fetch-page"]);
    expect(result.written?.text).toContain("<p>From the server</p>");
  });

  test("refuses another account's snapshot and writes nothing", async () => {
    const foreign = "users/u2/cards/upload-pending-v2/page-snapshot/s1";
    const result = await runArchiveOp(
      { snapshotKey: foreign },
      { seed: { [foreign]: await gzip("<p>Someone else's page</p>") } }
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatchObject({
      code: "INVALID_INPUT",
      message: "invalid_storage_key",
    });
    expect(result.written).toBeNull();
  });

  test("refuses a key that isn't a pending snapshot", async () => {
    const result = await runArchiveOp({
      snapshotKey: "users/u1/cards/c1/file/report.pdf",
    });
    expect(result.status).toBe(400);
    expect(result.written).toBeNull();
  });

  test("an oversized snapshot falls back to the fetched page", async () => {
    const noise = new Uint8Array(20 * 1024 * 1024 + 1024);
    for (let offset = 0; offset < noise.length; offset += 65_536) {
      crypto.getRandomValues(noise.subarray(offset, offset + 65_536));
    }
    const oversized = await gzip(noise);
    expect(oversized.byteLength).toBeGreaterThan(20 * 1024 * 1024);
    const result = await runArchiveOp(
      { snapshotKey: SNAPSHOT },
      { seed: { [SNAPSHOT]: oversized } }
    );
    expect(result.body.data).toMatchObject({ source: "server", stored: true });
    expect(result.written?.text).toContain("From the server");
  });

  test("a gzip bomb is cut at 60 MiB unzipped and falls back to the fetched page", async () => {
    const bomb = await gzip(new Uint8Array(61 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const result = await runArchiveOp(
      { snapshotKey: SNAPSHOT },
      { seed: { [SNAPSHOT]: bomb } }
    );
    expect(result.body.data).toMatchObject({ source: "server", stored: true });
  });

  test("a swept snapshot falls back to the fetched page", async () => {
    const result = await runArchiveOp({ snapshotKey: SNAPSHOT });
    expect(result.body.data).toMatchObject({ source: "server", stored: true });
  });

  test("a page the fetcher refuses stores nothing and says why", async () => {
    const result = await runArchiveOp(
      {},
      { fetcher: fetcherAnswering("", 422) }
    );
    expect(result.body.data).toEqual({ reason: "blocked_url", stored: false });
    expect(result.written).toBeNull();
  });

  test("refuses a destination outside the page-archive role", async () => {
    const result = await runArchiveOp({
      destinationKey: "users/u1/cards/c1/screenshot/r1",
    });
    expect(result.status).toBe(400);
  });
});
