// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { MAX_FILE_SIZE, readResponseBlobWithinLimit } from "@teak/files-core";
import {
  isSafeDownloadableAssetUrl,
  saveAssetUrlToTeak,
  saveFileToTeak,
} from "../../lib/saveFileToTeak";

const createDependencies = () => {
  const request = mock((path: string) =>
    Promise.resolve(
      Response.json(
        path === "/v1/uploads"
          ? {
              fileKey: "users/u/cards/pending/file/key",
              uploadUrl: "https://upload.example/file",
            }
          : { cardId: "card_1" }
      )
    )
  );
  const fetchImpl = mock(() =>
    Promise.resolve(
      new Response(null, { headers: { ETag: '"upload-etag"' }, status: 200 })
    )
  ) as unknown as typeof fetch;
  return { dependencies: { request, fetchImpl }, request };
};

describe("extension file saving", () => {
  test("uploads a user-selected source file through the OAuth REST API", async () => {
    const { dependencies, request } = createDependencies();
    const result = await saveFileToTeak(
      {
        bytes: new Blob(["export const value = 1"], { type: "text/tsx" }),
        fileName: "component.tsx",
        mimeType: "text/tsx",
        source: "popup-file",
      },
      dependencies
    );

    expect(result).toEqual({ cardId: "card_1", status: "saved" });
    expect(
      request.mock.calls.filter(([path]) => path === "/v1/uploads")
    ).toHaveLength(1);
    expect(JSON.parse(request.mock.calls[0]?.[1].body)).toMatchObject({
      fileName: "component.tsx",
      mimeType: "text/tsx",
    });
    expect(
      request.mock.calls.filter(([path]) => path === "/v1/cards")
    ).toHaveLength(1);
    expect(JSON.parse(request.mock.calls[1]?.[1].body)).toMatchObject({
      cardType: "document",
      fileEtag: '"upload-etag"',
      fileName: "component.tsx",
      mimeType: "text/tsx",
    });
  });

  test("surfaces unsupported and oversized files without uploading", async () => {
    const { dependencies, request } = createDependencies();
    await expect(
      saveFileToTeak(
        {
          bytes: new Blob(["x"]),
          fileName: "animation.riv",
          source: "popup-file",
        },
        dependencies
      )
    ).resolves.toMatchObject({ status: "error", code: "UNSUPPORTED_TYPE" });

    const oversized = {
      size: MAX_FILE_SIZE + 1,
      type: "application/zip",
    } as Blob;
    await expect(
      saveFileToTeak(
        {
          bytes: oversized,
          fileName: "archive.zip",
          source: "popup-file",
        },
        dependencies
      )
    ).resolves.toMatchObject({ status: "error", code: "FILE_TOO_LARGE" });
    expect(request).not.toHaveBeenCalled();
  });

  test("rejects local, private, blob, and file asset URLs without creating cards", async () => {
    const { dependencies, request } = createDependencies();
    for (const url of [
      "blob:https://example.com/id",
      "file:///tmp/photo.png",
      "http://localhost/photo.png",
      "http://192.168.1.2/photo.png",
      "http://[::1]/photo.png",
      "http://[::ffff:192.168.1.2]/photo.png",
      "http://[::ffff:c0a8:102]/photo.png",
      "http://[64:ff9b::c0a8:102]/photo.png",
      "https://user:password@example.com/photo.png",
      "https://example.com:8443/photo.png",
    ]) {
      expect(isSafeDownloadableAssetUrl(url)).toBe(false);
      await expect(
        saveAssetUrlToTeak(url, dependencies)
      ).resolves.toMatchObject({ code: "UNSAFE_ASSET_URL", status: "error" });
    }
    expect(
      isSafeDownloadableAssetUrl("https://cdn.example.com/photo.png")
    ).toBe(true);
    expect(isSafeDownloadableAssetUrl("https://8.8.8.8/photo.png")).toBe(true);
    expect(
      isSafeDownloadableAssetUrl("https://[2606:4700:4700::1111]/photo.png")
    ).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  test("downloads an accessible context-menu asset and saves it", async () => {
    const { dependencies } = createDependencies();
    const baseFetch = dependencies.fetchImpl;
    dependencies.fetchImpl = mock((url: string | URL | Request, init) => {
      if (String(url) === "https://cdn.example.com/vector.svg") {
        expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
        return Promise.resolve(
          new Response("<svg />", {
            headers: {
              "content-length": "7",
              "content-type": "image/svg+xml",
            },
          })
        );
      }
      return baseFetch(url, init);
    }) as unknown as typeof fetch;

    await expect(
      saveAssetUrlToTeak("https://cdn.example.com/vector.svg", dependencies)
    ).resolves.toEqual({ cardId: "card_1", status: "saved" });
  });

  test("cancels unknown-length asset streams before buffering past the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
    });

    const bytes = await readResponseBlobWithinLimit(
      new Response(stream, {
        headers: { "content-type": "application/octet-stream" },
      }),
      5
    );

    expect(bytes).toBeNull();
    expect(cancelled).toBe(true);
  });

  test("surfaces upload errors without finalizing a broken card", async () => {
    const { dependencies, request } = createDependencies();
    const baseFetch = dependencies.fetchImpl;
    dependencies.fetchImpl = mock((url: string | URL | Request, init) => {
      if (String(url) === "https://upload.example/file") {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return baseFetch(url, init);
    }) as unknown as typeof fetch;

    await expect(
      saveFileToTeak(
        {
          bytes: new Blob(["# Read me"], { type: "text/markdown" }),
          fileName: "readme.md",
          source: "popup-file",
        },
        dependencies
      )
    ).resolves.toMatchObject({
      message: "Upload failed with status 503",
      status: "error",
    });
    expect(
      request.mock.calls.filter(([path]) => path === "/v1/uploads")
    ).toHaveLength(1);
  });

  test("preserves stable Markdown preparation errors", async () => {
    const { dependencies, request } = createDependencies();
    request.mockResolvedValueOnce(
      Response.json(
        {
          code: "CONTENT_TOO_LARGE",
          error:
            "Text card content must not exceed 512 KiB when encoded as UTF-8.",
        },
        { status: 400 }
      )
    );

    await expect(
      saveFileToTeak(
        {
          bytes: new Blob(["# Read me"], { type: "text/markdown" }),
          fileName: "readme.md",
          source: "popup-file",
        },
        dependencies
      )
    ).resolves.toMatchObject({
      code: "CONTENT_TOO_LARGE",
      status: "error",
    });
    expect(
      request.mock.calls.filter(([path]) => path === "/v1/cards")
    ).toHaveLength(0);
  });
});
