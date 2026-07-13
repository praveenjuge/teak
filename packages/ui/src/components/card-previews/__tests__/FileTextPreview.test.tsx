import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FileTextPreview,
  SafeMarkdownPreview,
  SourceCodePreview,
} from "../FileTextPreview";
import {
  cachedFileTextPreview,
  loadFileTextPreview,
  prefetchFileTextPreview,
} from "../fileTextPreviewCache";
import { ImagePreview } from "../ImagePreview";
import { VideoPreview } from "../VideoPreview";

describe("file text previews", () => {
  test("escapes source code instead of executing markup", () => {
    const markup = renderToStaticMarkup(
      <SourceCodePreview
        code={'const value = "<script>alert(1)</script>";'}
        language="tsx"
      />
    );

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;");
  });

  test("sanitizes Markdown HTML and unsafe links", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdownPreview
        source={"# Safe\n<script>alert(1)</script>\n[bad](javascript:alert(1))"}
      />
    );

    expect(markup).toContain("Safe");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain('href="javascript:');
  });

  test("uses Typeset while keeping rendered source blocks isolated", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdownPreview
        source={"# Heading\n\n- Item\n\n```ts\nconst ok = true;\n```"}
      />
    );

    expect(markup).toContain('class="typeset typeset-docs max-w-[37em] pb-6"');
    expect(markup).toContain("data-not-typeset");
    expect(markup).not.toContain("prose prose-sm");
  });

  test("renders MDX as inert Markdown without a source disclosure", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdownPreview
        source={'import Widget from "./Widget"\n\n<Widget />'}
      />
    );

    expect(markup).not.toContain("<summary");
    expect(markup).not.toContain("<Widget");
    expect(markup).toContain("Widget");
  });

  test("cancels unknown-length previews before buffering past the limit", async () => {
    let cancelled = false;
    const fetchImpl = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
            start(controller) {
              controller.enqueue(new Uint8Array([65, 66, 67]));
              controller.enqueue(new Uint8Array([68, 69, 70]));
            },
          })
        )
      );

    await expect(
      loadFileTextPreview("https://files.example/source", {
        fetchImpl: fetchImpl as typeof fetch,
        maxBytes: 5,
      })
    ).resolves.toBeNull();
    expect(cancelled).toBe(true);
  });

  test("lets Cache-Control govern preview freshness instead of forcing stale reads", async () => {
    let requestInit: RequestInit | undefined;
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;
      return Promise.resolve(new Response("# Cached"));
    }) as typeof fetch;

    await loadFileTextPreview("https://files.example/cached.md", { fetchImpl });

    expect(requestInit?.cache).not.toBe("force-cache");
    expect(requestInit?.credentials).toBe("omit");
  });

  test("deduplicates intent prefetches by stable file key", async () => {
    let requestCount = 0;
    const fetchImpl = (() => {
      requestCount += 1;
      return Promise.resolve(new Response("# Prefetched"));
    }) as typeof fetch;
    const options = {
      cacheKey: "file-prefetch-test",
      fetchImpl,
      fileUrl: "https://files.example/prefetch.md",
    };

    await Promise.all([
      prefetchFileTextPreview(options),
      prefetchFileTextPreview(options),
    ]);
    await prefetchFileTextPreview({
      ...options,
      fileUrl: "https://files.example/refreshed-signature.md",
    });

    expect(requestCount).toBe(1);
  });

  test("expires cached previews after the signed URL lifetime", async () => {
    const realNow = Date.now;
    let requestCount = 0;
    const fetchImpl = (() => {
      requestCount += 1;
      return Promise.resolve(new Response("# Expiring"));
    }) as typeof fetch;
    const options = {
      cacheKey: "file-expiry-test",
      fetchImpl,
      fileUrl: "https://files.example/expiring.md",
    };
    const fifteenMinutesMs = 15 * 60 * 1000;
    const start = 1_000_000;

    try {
      Date.now = () => start;
      await prefetchFileTextPreview(options);
      expect(cachedFileTextPreview(options.cacheKey)).toBe("# Expiring");

      // Still served just before the 15-minute lifetime elapses.
      Date.now = () => start + fifteenMinutesMs - 1;
      expect(cachedFileTextPreview(options.cacheKey)).toBe("# Expiring");

      // Dropped once the lifetime passes, so a fresh fetch is required.
      Date.now = () => start + fifteenMinutesMs + 1;
      expect(cachedFileTextPreview(options.cacheKey)).toBeUndefined();

      await prefetchFileTextPreview(options);
      expect(requestCount).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  test("shows a Markdown-shaped skeleton while the preview loads", () => {
    const markup = renderToStaticMarkup(
      <FileTextPreview
        fileKey="file-loading-test"
        fileUrl="https://files.example/loading.md"
        format={{ preview: "markdown" } as never}
      />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading file preview"');
    expect(markup).toContain('data-slot="skeleton"');
  });

  test("prefers the rasterized derivative for SVG and HEIC", () => {
    for (const fileName of ["vector.svg", "photo.heic"]) {
      const markup = renderToStaticMarkup(
        <ImagePreview
          card={
            {
              content: fileName,
              fileMetadata: { fileName },
              fileUrl: "https://files.example/original",
              thumbnailUrl: "https://files.example/thumbnail.jpg",
            } as never
          }
        />
      );
      expect(markup).toContain("thumbnail.jpg");
      expect(markup).not.toContain('src="https://files.example/original"');
    }
  });

  test("keeps GIF motion in a native animated image preview", () => {
    const markup = renderToStaticMarkup(
      <VideoPreview
        card={
          {
            content: "motion",
            fileMetadata: { fileName: "motion.gif", mimeType: "image/gif" },
            fileUrl: "https://files.example/motion.gif",
          } as never
        }
      />
    );

    expect(markup).toContain("<img");
    expect(markup).not.toContain("<video");
  });

  test("falls back quietly when a HEIC thumbnail is unavailable", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          {
            fileMetadata: { fileName: "photo.heic", mimeType: "image/heic" },
          } as never
        }
      />
    );

    expect(markup).toContain("photo.heic");
    expect(markup).not.toContain("error");
  });
});
