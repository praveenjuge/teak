// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { getFunctionName } from "convex/server";

const PAGE_HTML = "<html><body><h1>Teak</h1></body></html>";
let kernelSessions = 0;
let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let screenshotAnswer:
  | { kind: "fallback" }
  | { kind: "ok"; data: Record<string, unknown> } = { kind: "fallback" };
let captureScreenshot: any;

beforeAll(async () => {
  mock.module("@onkernel/sdk", () => ({
    default: class KernelMock {
      browsers = {
        create: () => {
          kernelSessions += 1;
          return Promise.resolve({ session_id: "session-1" });
        },
        deleteByID: () => Promise.resolve(undefined),
        playwright: {
          execute: () =>
            Promise.resolve({
              success: true,
              result: JSON.stringify({ ok: true, status: 200 }),
            }),
        },
      };
    },
  }));

  const ssrfPath = import.meta.resolve("../../../../linkMetadata/ssrf");
  const actualSsrf = await import(ssrfPath);
  mock.module(ssrfPath, () => ({
    ...actualSsrf,
    safeFetch: () =>
      Promise.resolve(
        new Response(PAGE_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      ),
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
      buildSignedWorkerUploadUrl: async ({ key }: { key: string }) => ({
        expiresAt: 123,
        key,
        url: `https://files.example.com/__upload/v1/${encodeURIComponent(key)}?exp=123&sig=fake`,
      }),
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        workerCalls.push(spec);
        if (spec.op === "capture-screenshot") {
          return Promise.resolve(screenshotAnswer);
        }
        return Promise.resolve({
          kind: "ok",
          data: { contentType: "image/jpeg", exists: true, size: 2048 },
        });
      },
      isFilesWorkerConfigured: () => true,
    })
  );

  captureScreenshot = (
    await import("../../../../workflows/steps/screenshot/captureScreenshot")
  ).captureScreenshot;
});

beforeEach(() => {
  kernelSessions = 0;
  workerCalls = [];
  screenshotAnswer = { kind: "fallback" };
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

describe("captureScreenshot", () => {
  test("screenshots the fetched HTML in the Files Worker and records its size", async () => {
    screenshotAnswer = {
      kind: "ok",
      data: {
        height: 720,
        storedBytes: 3000,
        storedContentType: "image/jpeg",
        width: 1280,
      },
    };
    const { ctx, screenshots } = createCtx();

    await captureScreenshot(ctx, { cardId: "card-link" });

    expect(workerCalls.map(({ op }) => op)).toEqual(["capture-screenshot"]);
    const params = workerCalls[0]?.params as {
      destinationKey: string;
      htmlGzipBase64: string;
    };
    expect(params.destinationKey).toBe("users/u/cards/c/screenshot/shot.jpg");
    expect(
      gunzipSync(Buffer.from(params.htmlGzipBase64, "base64")).toString()
    ).toBe(PAGE_HTML);
    expect(screenshots).toEqual([
      expect.objectContaining({
        cardId: "card-link",
        screenshotHeight: 720,
        screenshotStorageKey: "users/u/cards/c/screenshot/shot.jpg",
        screenshotWidth: 1280,
      }),
    ]);
    expect(kernelSessions).toBe(0);
  });

  test("falls back to Kernel when the Worker has no Browser Run binding, registering one key", async () => {
    const { ctx, registered, screenshots } = createCtx();

    await captureScreenshot(ctx, { cardId: "card-link" });

    expect(kernelSessions).toBe(1);
    expect(workerCalls.map(({ op }) => op)).toEqual([
      "capture-screenshot",
      "head-object",
    ]);
    expect(screenshots).toHaveLength(1);
    expect(registered).toEqual(["users/u/cards/c/screenshot/shot.jpg"]);
  });
});
