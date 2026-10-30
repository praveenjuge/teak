import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "./lib";
import {
  captureHtmlScreenshot,
  decodeHtmlParam,
  MAX_RENDER_HTML_BYTES,
  scrapeHtml,
} from "./media/browserRender";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { launchLocalChrome, localChromeLease } from "./test/chromeTestSupport";
import { FakeBucket } from "./test/testsupport";

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
    "%s answers RENDERER_UNAVAILABLE when its binding is missing, so Convex retries",
    async (op, params) => {
      const bucket = new FakeBucket();
      await bucket.put(source, fixture("fixture.mp4"));
      await bucket.put("users/u/cards/c/file/a.pdf", fixture("fixture.pdf"));
      const { body, status } = await callOp(
        { BUCKET: bucket as never },
        op,
        params
      );
      expect(status).toBe(503);
      expect(body.error?.code).toBe("RENDERER_UNAVAILABLE");
      expect(bucket.objects.has(destination)).toBe(false);
    }
  );

  test.each([
    [
      "capture-screenshot",
      { destinationKey: destination, htmlGzipBase64: gzipBase64("<p>x</p>") },
    ],
    [
      "scrape-html",
      { htmlGzipBase64: gzipBase64("<p>x</p>"), selectors: ["p"] },
    ],
  ])(
    "%s answers RENDERER_UNAVAILABLE when Browser Run refuses a new browser",
    async (op, params) => {
      const bucket = new FakeBucket();
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
      expect(status).toBe(503);
      expect(body.error).toMatchObject({
        code: "RENDERER_UNAVAILABLE",
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
});
