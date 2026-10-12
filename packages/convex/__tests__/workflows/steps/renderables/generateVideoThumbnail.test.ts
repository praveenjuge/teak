// @ts-nocheck
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { getFunctionName } from "convex/server";

const PREVIOUS_ENV = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
};

let kernelSessions = 0;
let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let frameAnswer:
  | { kind: "fallback" }
  | { kind: "ok"; data: Record<string, unknown> } = { kind: "fallback" };
let generateVideoThumbnail: any;

beforeAll(async () => {
  process.env.FILES_BASE = "https://files.example.com";
  process.env.FILES_SIGNING_SECRET = "test-secret-for-urls";
  delete process.env.R2_KEY_PREFIX;

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
              result: JSON.stringify({
                height: 450,
                mimeType: "image/webp",
                originalHeight: 1080,
                originalWidth: 1920,
                success: true,
                width: 800,
              }),
            }),
        },
      };
    },
  }));

  const r2Path = import.meta.resolve("../../../../storage/r2");
  const actualR2 = await import(r2Path);
  mock.module(r2Path, () => ({
    ...actualR2,
    buildR2ObjectKey: () => "users/u/cards/c/thumbnail/generated",
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
        if (spec.op === "extract-video-frame") {
          return Promise.resolve(frameAnswer);
        }
        return Promise.resolve({
          kind: "ok",
          data: { contentType: "image/webp", exists: true, size: 2048 },
        });
      },
      isFilesWorkerConfigured: () => true,
    })
  );

  generateVideoThumbnail = (
    await import(
      "../../../../workflows/steps/renderables/generateVideoThumbnail"
    )
  ).generateVideoThumbnail;
});

afterAll(() => {
  for (const [name, value] of Object.entries(PREVIOUS_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

beforeEach(() => {
  kernelSessions = 0;
  workerCalls = [];
  frameAnswer = { kind: "fallback" };
});

const videoCard = {
  _id: "card-video",
  userId: "user-1",
  type: "video",
  fileKey: "users/u/cards/c/file/clip.mp4",
  fileMetadata: { mimeType: "video/mp4" },
};

const createCtx = () => {
  const thumbnails: any[] = [];
  return {
    ctx: {
      runQuery: () => Promise.resolve(videoCard),
      runMutation: (ref: any, args: any) => {
        if (getFunctionName(ref) === "storage/ownership:registerObject") {
          return Promise.resolve(true);
        }
        thumbnails.push(args);
        return Promise.resolve(null);
      },
    },
    thumbnails,
  };
};

describe("generateVideoThumbnail", () => {
  test("records a Media Transformations frame with the source dimensions and skips Kernel", async () => {
    frameAnswer = {
      kind: "ok",
      data: {
        durationSeconds: 12,
        originalHeight: 1920,
        originalWidth: 1080,
        storedBytes: 4096,
        storedContentType: "image/jpeg",
      },
    };
    const { ctx, thumbnails } = createCtx();

    const result = await generateVideoThumbnail(ctx, { cardId: "card-video" });

    expect(result).toEqual({
      success: true,
      generated: true,
      thumbnailKey: "users/u/cards/c/thumbnail/generated",
    });
    expect(workerCalls).toEqual([
      {
        op: "extract-video-frame",
        params: {
          destinationKey: "users/u/cards/c/thumbnail/generated",
          sourceKey: "users/u/cards/c/file/clip.mp4",
        },
      },
    ]);
    expect(thumbnails).toEqual([
      {
        cardId: "card-video",
        originalHeight: 1920,
        originalWidth: 1080,
        thumbnailKey: "users/u/cards/c/thumbnail/generated",
      },
    ]);
    expect(kernelSessions).toBe(0);
  });

  test("omits dimensions the container did not report", async () => {
    frameAnswer = {
      kind: "ok",
      data: {
        durationSeconds: null,
        originalHeight: null,
        originalWidth: null,
        storedBytes: 4096,
        storedContentType: "image/jpeg",
      },
    };
    const { ctx, thumbnails } = createCtx();

    await generateVideoThumbnail(ctx, { cardId: "card-video" });

    expect(thumbnails).toEqual([
      {
        cardId: "card-video",
        thumbnailKey: "users/u/cards/c/thumbnail/generated",
      },
    ]);
  });

  test("keeps Kernel for videos the Worker declines (WebM, HEVC, over 100 MB)", async () => {
    const { ctx, thumbnails } = createCtx();

    const result = await generateVideoThumbnail(ctx, { cardId: "card-video" });

    expect(result.generated).toBe(true);
    expect(kernelSessions).toBe(1);
    expect(workerCalls.map(({ op }) => op)).toEqual([
      "extract-video-frame",
      "head-object",
    ]);
    expect(thumbnails[0]).toMatchObject({
      originalHeight: 1080,
      originalWidth: 1920,
    });
  });
});
