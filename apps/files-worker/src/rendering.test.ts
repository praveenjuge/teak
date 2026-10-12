import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import {
  captureHtmlScreenshot,
  decodeHtmlParam,
  MAX_RENDER_HTML_BYTES,
  type PdfJsSources,
  readPdfSource,
  renderPdfFirstPage,
  scrapeHtml,
} from "./browserRender";
import { launchLocalChrome, localChromeLease } from "./chromeTestSupport";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { paletteFromPng } from "./palette";
import { FakeBucket } from "./testsupport";
import type { MediaTransformsBinding } from "./videoFrame";

const require = createRequire(import.meta.url);
// Byte-identical to the cdnjs files the Worker pins by SHA-256.
const pdfJs: PdfJsSources = {
  lib: readFileSync(require.resolve("pdfjs-dist/build/pdf.min.js"), "utf8"),
  worker: readFileSync(
    require.resolve("pdfjs-dist/build/pdf.worker.min.js"),
    "utf8"
  ),
};

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const gzipBase64 = (html: string) =>
  Buffer.from(gzipSync(Buffer.from(html))).toString("base64");

const jpegSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    const marker = bytes[offset + 1] as number;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
};

const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
};

// Any request that escapes the offline page lands here.
let hits: string[] = [];
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      hits.push(new URL(request.url).pathname);
      return new Response("tracked", {
        headers: { "access-control-allow-origin": "*" },
      });
    },
  });
});
afterAll(() => server.stop(true));

describe("browser rendering against a real Chrome", () => {
  test("renders the first PDF page to a white-backed PNG at three times its size", async () => {
    const rendered = await renderPdfFirstPage(
      localChromeLease,
      fixture("fixture.pdf"),
      pdfJs
    );
    // The fixture page is 200x100 pt; scale is min(3, 1600/200, 1600/100).
    expect({ height: rendered.height, width: rendered.width }).toEqual({
      height: 300,
      width: 600,
    });
    expect(pngSize(rendered.png)).toEqual({ height: 300, width: 600 });
    // The page is filled red with a line of black text.
    expect(paletteFromPng(rendered.png)[0]).toBe("#FF0000");
  }, 60_000);

  test("captures a 1280x720 JPEG of offline HTML without loading its resources", async () => {
    hits = [];
    const origin = `http://127.0.0.1:${server.port}`;
    const html = `<!doctype html><html><body style="margin:0;background:#1e40af">
      <img src="${origin}/pixel.png">
      <link rel="stylesheet" href="${origin}/style.css">
      <script>fetch("${origin}/fetch").catch(() => {});</script>
      <div class="cookie-banner" style="height:300px;background:#fff">cookies</div>
    </body></html>`;
    const jpeg = await captureHtmlScreenshot(localChromeLease, html);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    expect(jpegSize(jpeg)).toEqual({ height: 720, width: 1280 });
    expect(hits).toEqual([]);
  }, 60_000);

  test("scrapes selectors after inline scripts run, with sockets and network disabled", async () => {
    hits = [];
    const origin = `http://127.0.0.1:${server.port}`;
    const html = `<!doctype html><html><head>
      <title>Static title</title>
      <meta property="og:title" content="Card title">
      <meta property="og:image" content="https://cdn.example/cover.jpg">
      <script>
        let socket = "allowed";
        try { new WebSocket("ws://127.0.0.1:${server.port}"); } catch { socket = "blocked"; }
        document.title = "Scripted title (" + socket + ")";
        fetch("${origin}/beacon").catch(() => {});
      </script>
    </head><body><img src="${origin}/img.png"></body></html>`;
    const result = await scrapeHtml(localChromeLease, html, [
      "title",
      'meta[property="og:image"]',
      "article h1",
    ]);
    expect(result.selectors).toEqual([
      {
        selector: "title",
        results: [
          {
            html: "Scripted title (blocked)",
            text: "Scripted title (blocked)",
          },
        ],
      },
      {
        selector: 'meta[property="og:image"]',
        results: [
          {
            attributes: [
              { name: "property", value: "og:image" },
              { name: "content", value: "https://cdn.example/cover.jpg" },
            ],
          },
        ],
      },
      { selector: "article h1", results: [] },
    ]);
    expect(hits).toEqual([]);
  }, 60_000);

  test("runs operations back to back in one shared browser, each in its own context and still offline", async () => {
    hits = [];
    const origin = `http://127.0.0.1:${server.port}`;
    const browser = await launchLocalChrome();
    let releases = 0;
    const shared = () =>
      Promise.resolve({
        browser,
        release: () => {
          releases += 1;
          return Promise.resolve();
        },
      });
    try {
      const jpeg = await captureHtmlScreenshot(
        shared,
        `<body><img src="${origin}/first.png">first</body>`
      );
      const result = await scrapeHtml(
        shared,
        `<title>second</title><img src="${origin}/second.png">`,
        ["title"]
      );

      expect(jpegSize(jpeg)).toEqual({ height: 720, width: 1280 });
      expect(result.selectors[0]?.results[0]?.text).toBe("second");
      expect(releases).toBe(2);
      expect(browser.connected).toBe(true);
      // Each operation closed its context, leaving only the default one.
      expect(browser.browserContexts()).toHaveLength(1);
      expect(hits).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("decodeHtmlParam", () => {
  test("round-trips gzip-compressed UTF-8 HTML", async () => {
    expect(await decodeHtmlParam(gzipBase64("<p>café ☕</p>"))).toBe(
      "<p>café ☕</p>"
    );
  });

  test("refuses HTML that inflates past the 2 MiB rendering limit", async () => {
    const bomb = gzipBase64("a".repeat(MAX_RENDER_HTML_BYTES + 1));
    expect(bomb.length).toBeLessThan(10_000);
    await expect(decodeHtmlParam(bomb)).rejects.toThrow("source_too_large");
  });

  test.each([["not base64 !!"], [""], [42]])(
    "rejects %p as invalid HTML",
    async (value) => {
      await expect(decodeHtmlParam(value)).rejects.toThrow("invalid_html");
    }
  );
});

describe("readPdfSource", () => {
  test("refuses an object that is not a PDF", async () => {
    const bucket = new FakeBucket();
    await bucket.put("users/u/cards/c/file/a.pdf", fixture("fixture.png"));
    await expect(
      readPdfSource(bucket as never, "users/u/cards/c/file/a.pdf")
    ).rejects.toThrow("not_a_pdf");
  });
});

const SECRET = "test-secret";
const callOp = async (
  env: Partial<FilesOpsEnv>,
  op: string,
  params: Record<string, unknown>
) => {
  const body = JSON.stringify({ op, params, version: FILES_PROTOCOL_VERSION });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const bodySha256 = await sha256Hex(body);
  const response = await handleInternalOp(
    new Request("https://files.teakvault.com/__ops/v1", {
      body,
      headers: {
        "x-teak-expires-at": expiresAt,
        "x-teak-request-id": requestId,
        "x-teak-signature": await hmacSha256Hex(
          SECRET,
          buildFilesOpSigningPayload({ bodySha256, expiresAt, requestId })
        ),
      },
      method: "POST",
    }),
    { FILES_SIGNING_SECRET: SECRET, ...env } as FilesOpsEnv
  );
  return {
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; message: string };
    },
    status: response.status,
  };
};

describe("rendering operations", () => {
  const source = "users/u/cards/c/file/clip.mp4";
  const destination = "users/u/cards/c/thumbnail/frame.jpg";

  test.each([
    [
      "render-pdf-thumbnail",
      { sourceKey: "users/u/cards/c/file/a.pdf", destinationKey: destination },
    ],
    [
      "capture-screenshot",
      { destinationKey: destination, htmlGzipBase64: gzipBase64("<p>x</p>") },
    ],
    [
      "scrape-html",
      { htmlGzipBase64: gzipBase64("<p>x</p>"), selectors: ["p"] },
    ],
    ["extract-video-frame", { sourceKey: source, destinationKey: destination }],
  ])(
    "%s answers UNSUPPORTED when its binding is missing, so Convex keeps its old renderer",
    async (op, params) => {
      const bucket = new FakeBucket();
      await bucket.put(source, fixture("fixture.mp4"));
      await bucket.put("users/u/cards/c/file/a.pdf", fixture("fixture.pdf"));
      const { body, status } = await callOp(
        { BUCKET: bucket as never },
        op,
        params
      );
      expect(status).toBe(415);
      expect(body.error?.code).toBe("UNSUPPORTED");
      expect(bucket.objects.has(destination)).toBe(false);
    }
  );

  test.each([
    [
      "render-pdf-thumbnail",
      { sourceKey: "users/u/cards/c/file/a.pdf", destinationKey: destination },
    ],
    [
      "capture-screenshot",
      { destinationKey: destination, htmlGzipBase64: gzipBase64("<p>x</p>") },
    ],
    [
      "scrape-html",
      { htmlGzipBase64: gzipBase64("<p>x</p>"), selectors: ["p"] },
    ],
  ])(
    "%s answers UNSUPPORTED when Browser Run refuses a new browser, so Convex uses Kernel",
    async (op, params) => {
      const bucket = new FakeBucket();
      await bucket.put("users/u/cards/c/file/a.pdf", fixture("fixture.pdf"));
      const browserRun = {
        fetch: () =>
          Promise.resolve(
            new Response("Browser time limit exceeded for today", {
              status: 429,
            })
          ),
      };
      const { body, status } = await callOp(
        { BROWSER: browserRun, BUCKET: bucket as never } as never,
        op,
        params
      );
      expect(status).toBe(415);
      expect(body.error).toMatchObject({
        code: "UNSUPPORTED",
        message: "browser_unavailable",
      });
      expect(bucket.objects.has(destination)).toBe(false);
    }
  );

  test.each([
    ["another user's namespace", "users/other/cards/c/thumbnail/frame.jpg"],
    ["a traversal path", "users/u/cards/../../other/x.jpg"],
    ["the source itself", source],
  ])("refuses a destination in %s", async (_name, destinationKey) => {
    const bucket = new FakeBucket();
    await bucket.put(source, fixture("fixture.mp4"));
    const { body, status } = await callOp(
      { BUCKET: bucket as never },
      "extract-video-frame",
      { destinationKey, sourceKey: source }
    );
    expect(status).toBe(400);
    expect(body.error?.message).toBe("invalid_storage_key");
  });

  const fakeMedia = (
    calls: unknown[],
    frame: Uint8Array
  ): MediaTransformsBinding => ({
    input: (stream) => ({
      transform: (transform) => ({
        output: (output) => ({
          response: async () => {
            calls.push({
              bytes: (await new Response(stream).arrayBuffer()).byteLength,
              output,
              transform,
            });
            return new Response(frame);
          },
        }),
      }),
    }),
  });

  test("extracts a frame one second into an H.264 MP4 and stores it as a JPEG", async () => {
    const bucket = new FakeBucket();
    const video = fixture("fixture.mp4");
    await bucket.put(source, video);
    const calls: unknown[] = [];
    const frame = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const { body, status } = await callOp(
      { BUCKET: bucket as never, MEDIA: fakeMedia(calls, frame) },
      "extract-video-frame",
      { destinationKey: destination, sourceKey: source }
    );
    expect(status).toBe(200);
    expect(body.data).toEqual({
      durationSeconds: 2.5,
      originalHeight: 36,
      originalWidth: 64,
      storedBytes: frame.length,
      storedContentType: "image/jpeg",
    });
    expect(calls).toEqual([
      {
        bytes: video.length,
        output: { format: "jpg", mode: "frame", time: "1s" },
        transform: { fit: "scale-down", height: 1600, width: 1600 },
      },
    ]);
    expect(bucket.objects.get(destination)).toMatchObject({
      bytes: frame,
      httpMetadata: { contentType: "image/jpeg" },
    });
  });

  test("leaves WebM to the browser renderer", async () => {
    const bucket = new FakeBucket();
    const webm = "users/u/cards/c/file/clip.webm";
    await bucket.put(webm, fixture("fixture.webm"));
    const calls: unknown[] = [];
    const { body, status } = await callOp(
      {
        BUCKET: bucket as never,
        MEDIA: fakeMedia(calls, new Uint8Array([0xff, 0xd8])),
      },
      "extract-video-frame",
      { destinationKey: destination, sourceKey: webm }
    );
    expect(status).toBe(415);
    expect(body.error?.message).toBe("video_format_unsupported");
    expect(calls).toEqual([]);
  });

  test("refuses a Media response that is not a JPEG", async () => {
    const bucket = new FakeBucket();
    await bucket.put(source, fixture("fixture.mp4"));
    const { status } = await callOp(
      {
        BUCKET: bucket as never,
        MEDIA: fakeMedia([], new TextEncoder().encode("<html>error</html>")),
      },
      "extract-video-frame",
      { destinationKey: destination, sourceKey: source }
    );
    expect(status).toBe(415);
    expect(bucket.objects.has(destination)).toBe(false);
  });

  test("probe-media reports container facts for a stored video", async () => {
    const bucket = new FakeBucket();
    await bucket.put(source, fixture("fixture.mp4"));
    const { body, status } = await callOp(
      { BUCKET: bucket as never },
      "probe-media",
      { sourceKey: source }
    );
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      container: "mp4",
      durationSeconds: 2.5,
      height: 36,
      width: 64,
    });
  });
});
