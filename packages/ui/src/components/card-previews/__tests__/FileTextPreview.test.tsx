import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  loadFileTextPreview,
  SafeMarkdownPreview,
  SourceCodePreview,
} from "../FileTextPreview";
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

  test("renders MDX as inert Markdown with a source fallback", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdownPreview
        source={'import Widget from "./Widget"\n\n<Widget />'}
      />
    );

    expect(markup).toContain("Source");
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
