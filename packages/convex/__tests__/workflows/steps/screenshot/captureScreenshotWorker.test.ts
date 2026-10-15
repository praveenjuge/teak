// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { getFunctionName } from "convex/server";
import { parseScreenshotRetryableError } from "../../../../workflows/screenshot";

const PAGE_HTML = "<html><body><h1>Teak</h1></body></html>";
let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let screenshotAnswer: () => Promise<unknown>;
let page: () => Response;
let captureScreenshot: any;

beforeAll(async () => {
  const ssrfPath = import.meta.resolve("../../../../linkMetadata/ssrf");
  const actualSsrf = await import(ssrfPath);
  mock.module(ssrfPath, () => ({
    ...actualSsrf,
    safeFetch: (url: string) =>
      Promise.resolve({ finalUrl: url, response: page() }),
  }));

  const r2Path = import.meta.resolve("../../../../storage/r2");
  const actualR2 = await import(r2Path);
  mock.module(r2Path, () => ({
    ...actualR2,
    buildR2ObjectKey: () => "users/u/cards/c/screenshot/shot.jpg",
  }));

  mock.module(
    import.meta.resolve("../../../../storage/filesWorkerClient"),
    () => ({
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        workerCalls.push(spec);
        return screenshotAnswer();
      },
      isFilesWorkerConfigured: () => true,
    })
  );

  captureScreenshot = (
    await import("../../../../workflows/steps/screenshot/captureScreenshot")
  ).captureScreenshot;
});

beforeEach(() => {
  workerCalls = [];
  page = () =>
    new Response(PAGE_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  screenshotAnswer = () =>
    Promise.resolve({
      kind: "ok",
      data: {
        height: 720,
        storedBytes: 3000,
        storedContentType: "image/jpeg",
        width: 1280,
      },
    });
});

const createCtx = () => {
  const screenshots: any[] = [];
  const registered: string[] = [];
  return {
    registered,
    ctx: {
      runQuery: () =>
        Promise.resolve({
          _id: "card-link",
          userId: "user-1",
          type: "link",
          url: "https://example.com/article",
          metadata: { linkPreview: { status: "success" } },
        }),
      runMutation: (ref: any, args: any) => {
        if (getFunctionName(ref) === "storage/ownership:registerObject") {
          registered.push(args.key);
        } else {
          screenshots.push(args);
        }
        return Promise.resolve(true);
      },
    },
    screenshots,
  };
};

const retryableType = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return parseScreenshotRetryableError(error)?.type ?? "not retryable";
  }
  return "resolved";
};

describe("captureScreenshot", () => {
  test("screenshots the fetched HTML in the Files Worker and records its size", async () => {
    const { ctx, registered, screenshots } = createCtx();

    expect(await captureScreenshot(ctx, { cardId: "card-link" })).toEqual({
      status: "captured",
    });

    expect(workerCalls.map(({ op }) => op)).toEqual(["capture-screenshot"]);
    const params = workerCalls[0]?.params as {
      destinationKey: string;
      htmlGzipBase64: string;
    };
    expect(params.destinationKey).toBe("users/u/cards/c/screenshot/shot.jpg");
    expect(
      gunzipSync(Buffer.from(params.htmlGzipBase64, "base64")).toString()
    ).toBe(PAGE_HTML);
    expect(registered).toEqual(["users/u/cards/c/screenshot/shot.jpg"]);
    expect(screenshots).toEqual([
      expect.objectContaining({
        cardId: "card-link",
        screenshotHeight: 720,
        screenshotStorageKey: "users/u/cards/c/screenshot/shot.jpg",
        screenshotWidth: 1280,
      }),
    ]);
  });

  test("throws a renderer_unavailable retry when Browser Run is busy", async () => {
    screenshotAnswer = () =>
      Promise.reject(
        new Error("files_worker_error:RENDERER_UNAVAILABLE:503:r")
      );
    const { ctx, screenshots } = createCtx();

    expect(
      await retryableType(captureScreenshot(ctx, { cardId: "card-link" }))
    ).toBe("renderer_unavailable");
    expect(screenshots).toEqual([]);
  });

  test("fails quietly when the Worker declines the page", async () => {
    screenshotAnswer = () =>
      Promise.resolve({
        kind: "fallback",
        code: "PAYLOAD_TOO_LARGE",
        message: "source_too_large",
      });
    const { ctx } = createCtx();

    expect(await captureScreenshot(ctx, { cardId: "card-link" })).toEqual({
      reason: "declined:payload_too_large:source_too_large",
      status: "failed",
    });
  });

  test.each([
    ["a missing page", 404, "text/html", "http_404"],
    ["a PDF link", 200, "application/pdf", "not_html"],
  ])(
    "fails quietly for %s without calling the Worker",
    async (_name, status, type, reason) => {
      page = () =>
        new Response("x", { headers: { "content-type": type }, status });
      const { ctx } = createCtx();

      expect(await captureScreenshot(ctx, { cardId: "card-link" })).toEqual({
        reason,
        status: "failed",
      });
      expect(workerCalls).toEqual([]);
    }
  );

  test("retries a page whose server is failing", async () => {
    page = () => new Response("down", { status: 503 });
    const { ctx } = createCtx();

    expect(
      await retryableType(captureScreenshot(ctx, { cardId: "card-link" }))
    ).toBe("http_error");
  });
});
