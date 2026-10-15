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

let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let frameAnswer: () => Promise<unknown>;
let generateVideoThumbnail: any;

// These tests mock the Files Worker, so declare it configured:
// ensureObjectOwnership refuses to register objects without one.
const savedFilesEnv = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
};

beforeAll(async () => {
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  const r2Path = import.meta.resolve("../../../../storage/r2");
  const actualR2 = await import(r2Path);
  mock.module(r2Path, () => ({
    ...actualR2,
    buildR2ObjectKey: ({ role }: { role: string }) =>
      `users/u/cards/c/${role}/generated`,
  }));
  mock.module(
    import.meta.resolve("../../../../storage/filesWorkerClient"),
    () => ({
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        workerCalls.push(spec);
        return frameAnswer();
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
  for (const name of ["FILES_BASE", "FILES_SIGNING_SECRET"] as const) {
    const original = savedFilesEnv[name];
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
});

beforeEach(() => {
  workerCalls = [];
});

const videoCard = {
  _id: "card-video",
  userId: "user-1",
  type: "video",
  fileKey: "users/u/cards/c/file/clip.webm",
  fileMetadata: { mimeType: "video/webm" },
};

const run = async (
  card: Record<string, unknown> = videoCard,
  options: { rerender?: boolean } = {}
) => {
  const owned: string[] = [];
  const updates: any[] = [];
  const ctx = {
    runQuery: () => Promise.resolve(card),
    runMutation: (ref: any, args: any) => {
      if (getFunctionName(ref) === "storage/ownership:registerObject") {
        owned.push(args.key);
        return Promise.resolve(true);
      }
      updates.push({ name: getFunctionName(ref), args });
      return Promise.resolve(null);
    },
  };
  const result = await generateVideoThumbnail(ctx, {
    cardId: "card-video",
    ...options,
  });
  return { owned, result, updates };
};

const frame = (scrub: unknown, palette?: string[]) => ({
  kind: "ok",
  data: {
    durationSeconds: 12.3456,
    originalHeight: 1080,
    originalWidth: 1920,
    ...(palette && { palette }),
    scrub,
    storedBytes: 2048,
    storedContentType: "image/jpeg",
  },
});

describe("generateVideoThumbnail", () => {
  test("records the frame, scrub sprite and duration in one update", async () => {
    frameAnswer = () =>
      Promise.resolve(frame({ frameHeight: 180, frameWidth: 320, frames: 10 }));
    const { owned, result, updates } = await run();

    expect(result).toEqual({
      generated: true,
      success: true,
      thumbnailKey: "users/u/cards/c/thumbnail/generated",
    });
    expect(workerCalls).toEqual([
      {
        op: "extract-video-frame",
        params: {
          destinationKey: "users/u/cards/c/thumbnail/generated",
          scrubDestinationKey: "users/u/cards/c/scrub/generated",
          sourceKey: videoCard.fileKey,
        },
      },
    ]);
    expect(owned).toEqual([
      "users/u/cards/c/thumbnail/generated",
      "users/u/cards/c/scrub/generated",
    ]);
    expect(updates).toEqual([
      {
        name: "workflows/steps/renderables/mutations:updateCardThumbnail",
        args: {
          cardId: "card-video",
          duration: 12.346,
          originalHeight: 1080,
          originalWidth: 1920,
          scrub: { frameHeight: 180, frameWidth: 320, frames: 10 },
          scrubKey: "users/u/cards/c/scrub/generated",
          thumbnailKey: "users/u/cards/c/thumbnail/generated",
        },
      },
    ]);
  });

  test("stores the colors the renderer read across the video", async () => {
    frameAnswer = () => Promise.resolve(frame(null, ["#0EFB0B", "#0806FD"]));
    const { updates } = await run();

    expect(updates.map((update) => update.name)).toEqual([
      "workflows/steps/renderables/mutations:updateCardThumbnail",
      "workflows/aiMetadata/mutations:updateCardColors",
    ]);
    expect(updates[1]?.args).toEqual({
      cardId: "card-video",
      colors: [{ hex: "#0EFB0B" }, { hex: "#0806FD" }],
    });
  });

  test("keeps the frame without a scrub key when no sprite was made", async () => {
    frameAnswer = () => Promise.resolve(frame(null));
    const { updates } = await run();

    expect(updates[0]?.args).not.toHaveProperty("scrubKey");
    expect(updates[0]?.args).not.toHaveProperty("scrub");
  });

  test("fails without a retry when the renderer cannot decode the video", async () => {
    frameAnswer = () =>
      Promise.resolve({
        kind: "fallback",
        code: "UNSUPPORTED",
        message: "renderer_declined:unsupported",
      });
    const { result, updates } = await run();

    expect(result).toEqual({
      error:
        "video_thumbnail_declined:unsupported:renderer_declined:unsupported",
      generated: false,
      retryable: false,
      success: false,
    });
    expect(updates).toEqual([]);
  });

  test("asks for a retry when the renderer is busy or unavailable", async () => {
    frameAnswer = () =>
      Promise.reject(
        new Error("files_worker_error:RENDERER_UNAVAILABLE:503:req-1")
      );
    const { result, updates } = await run();

    expect(result).toMatchObject({
      error: "files_worker_error:RENDERER_UNAVAILABLE:503:req-1",
      retryable: true,
      success: false,
    });
    expect(updates).toEqual([]);
  });

  test("leaves a card that already has a thumbnail alone", async () => {
    frameAnswer = () => Promise.resolve(frame(null));
    const { result } = await run({ ...videoCard, thumbnailKey: "existing" });

    expect(result).toEqual({
      generated: false,
      success: true,
      thumbnailKey: "existing",
    });
    expect(workerCalls).toEqual([]);
  });

  test("a rerender writes over the card's existing thumbnail and sprite", async () => {
    frameAnswer = () =>
      Promise.resolve(
        frame({ frameHeight: 180, frameWidth: 320, frames: 10 }, ["#0EFB0B"])
      );
    const { owned, result, updates } = await run(
      {
        ...videoCard,
        thumbnailKey: "users/u/cards/c/thumbnail/old",
        scrubKey: "users/u/cards/c/scrub/old",
      },
      { rerender: true }
    );

    expect(result).toEqual({
      generated: true,
      success: true,
      thumbnailKey: "users/u/cards/c/thumbnail/old",
    });
    expect(workerCalls[0]?.params).toEqual({
      destinationKey: "users/u/cards/c/thumbnail/old",
      scrubDestinationKey: "users/u/cards/c/scrub/old",
      sourceKey: videoCard.fileKey,
    });
    expect(owned).toEqual([
      "users/u/cards/c/thumbnail/old",
      "users/u/cards/c/scrub/old",
    ]);
    expect(updates.map((update) => update.name)).toEqual([
      "workflows/steps/renderables/mutations:updateCardThumbnail",
      "workflows/aiMetadata/mutations:updateCardColors",
    ]);
  });
});
