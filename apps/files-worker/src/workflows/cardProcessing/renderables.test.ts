import { describe, expect, test } from "bun:test";
import type { FilesOp } from "@teak/files-protocol";
import {
  CARD_ID,
  createCardConvex,
  createFakeOps,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import { extractPaletteFromImage, generateRenderables } from "./renderables";

const BUSY = new Error("files_worker_error:RENDERER_UNAVAILABLE:503:r");

const setup = (
  fields: Partial<FakeCard> | null,
  answers: Partial<Record<FilesOp, OpAnswer>> = {},
  handlers: Parameters<typeof createCardConvex>[1] = {}
) => {
  const card = fields
    ? makeCard({
        processingStatus: { renderables: { status: "pending" } },
        ...fields,
      })
    : null;
  const convex = createCardConvex(card, handlers);
  const fakes = createFakeOps(answers);
  const env = testEnv();
  const job = testJob(env, testDeps(env, convex.fetcher, fakes.ops));
  const lastCall = (name: string) =>
    convex.callsTo(`workflows/steps/renderables/mutations:${name}`).at(-1)
      ?.args;
  return {
    card,
    colors: () =>
      convex
        .callsTo("workflows/aiMetadata/mutations:updateCardColors")
        .map((call) => call.args.colors),
    convex,
    fakes,
    lastCall,
    run: (cardType: string) => generateRenderables(job, cardType),
    runPalette: () => extractPaletteFromImage(job),
  };
};

const frame = (fields: Record<string, unknown> = {}): OpAnswer => ({
  data: {
    durationSeconds: 12.3456,
    facts: null,
    originalHeight: 720,
    originalWidth: 1280,
    palette: [],
    scrub: { frameHeight: 90, frameWidth: 160, frames: 20 },
    ...fields,
  },
});

describe("renderables", () => {
  test("a card deleted before rendering is skipped", async () => {
    const { run } = setup(null);
    expect(await run("image")).toEqual({
      mode: "skipped",
      success: true,
      thumbnailGenerated: false,
    });
  });

  describe("images", () => {
    test("records the image's size, EXIF and colors and completes the stage", async () => {
      const { card, colors, lastCall, run } = setup(
        {
          fileKey: "users/x/cards/c/file/a.png",
          fileMetadata: { mimeType: "image/png" },
          type: "image",
        },
        {
          "analyze-image": {
            data: {
              exif: { make: "Fuji" },
              height: 600,
              palette: ["#112233", "#445566"],
              width: 800,
            },
          },
        }
      );
      expect(await run("image")).toEqual({
        mode: "completed",
        success: true,
        thumbnailGenerated: false,
      });
      expect(lastCall("updateCardFileMetadata")).toEqual({
        cardId: CARD_ID,
        exif: { make: "Fuji" },
        height: 600,
        width: 800,
      });
      expect(colors()).toEqual([[{ hex: "#112233" }, { hex: "#445566" }]]);
      expect(card?.processingStatus?.renderables).toMatchObject({
        confidence: 0.95,
        status: "completed",
      });
    });

    test("keeps no colors for a tiny image", async () => {
      const { colors, run } = setup(
        { fileKey: "users/x/cards/c/file/a.png", type: "image" },
        {
          "analyze-image": {
            data: { height: 4, palette: ["#000000"], width: 4 },
          },
        }
      );
      await run("image");
      expect(colors()).toEqual([]);
    });

    test("fails the stage when the image cannot be analyzed", async () => {
      const { card, run } = setup(
        { fileKey: "users/x/cards/c/file/a.png", type: "image" },
        { "analyze-image": { fallback: "UNSUPPORTED" } }
      );
      expect((await run("image")).success).toBe(false);
      expect(card?.processingStatus?.renderables).toMatchObject({
        error: "files_worker_image_analysis_unavailable",
        status: "failed",
      });
    });

    test("an image without a file renders nothing", async () => {
      const { fakes, run } = setup({ type: "image" });
      expect((await run("image")).success).toBe(true);
      expect(fakes.calls).toEqual([]);
    });
  });

  describe("videos", () => {
    const video = {
      fileKey: "users/x/cards/c/file/a.mp4",
      fileMetadata: { fileName: "a.mp4", mimeType: "video/mp4" },
      type: "video",
    };

    test("records the frame, scrub sprite and duration in one update", async () => {
      const { convex, fakes, lastCall, run } = setup(video, {
        "extract-video-frame": frame(),
      });
      expect((await run("video")).thumbnailGenerated).toBe(true);
      const params = fakes.calls[0]?.params as Record<string, string>;
      expect(params.sourceKey).toBe(video.fileKey);
      expect(params.destinationKey).toContain(`/${CARD_ID}/thumbnail/`);
      expect(params.scrubDestinationKey).toContain(`/${CARD_ID}/scrub/`);
      expect(
        convex
          .callsTo("storage/ownership:registerObject")
          .map((call) => call.args)
      ).toEqual([
        { key: params.destinationKey, userId: USER_ID },
        { key: params.scrubDestinationKey, userId: USER_ID },
      ]);
      expect(lastCall("updateCardThumbnail")).toEqual({
        cardId: CARD_ID,
        duration: 12.346,
        originalHeight: 720,
        originalWidth: 1280,
        scrub: { frameHeight: 90, frameWidth: 160, frames: 20 },
        scrubKey: params.scrubDestinationKey,
        thumbnailKey: params.destinationKey,
      });
    });

    test("stores the colors the renderer read across the video", async () => {
      const { colors, run } = setup(video, {
        "extract-video-frame": frame({ palette: ["#aa0000"] }),
      });
      await run("video");
      expect(colors()).toEqual([[{ hex: "#aa0000" }]]);
    });

    test("keeps the frame without a scrub key when no sprite was made", async () => {
      const { lastCall, run } = setup(video, {
        "extract-video-frame": frame({ scrub: null }),
      });
      await run("video");
      expect(lastCall("updateCardThumbnail")).not.toHaveProperty("scrubKey");
    });

    test("fails without a retry when the renderer cannot decode the video", async () => {
      const { card, fakes, run } = setup(video, {
        "extract-video-frame": { fallback: "UNSUPPORTED", message: "codec" },
        "probe-media": { fallback: "UNSUPPORTED" },
      });
      expect((await run("video")).success).toBe(false);
      expect(card?.processingStatus?.renderables).toMatchObject({
        error: "video_thumbnail_declined:unsupported:codec",
        status: "failed",
      });
      expect(fakes.opsCalled()).toEqual(["extract-video-frame", "probe-media"]);
    });

    test("a busy renderer throws so the step retries, before any stage write", async () => {
      const { card, run } = setup(video, {
        "extract-video-frame": { throws: BUSY },
      });
      await expect(run("video")).rejects.toThrow(
        "renderables_retryable:files_worker_error:RENDERER_UNAVAILABLE"
      );
      expect(card?.processingStatus?.renderables?.status).toBe("in_progress");
    });

    test("a video that already has a thumbnail only gets its container facts", async () => {
      const { fakes, lastCall, run } = setup(
        { ...video, thumbnailKey: "users/x/cards/c/thumbnail/t" },
        {
          "probe-media": {
            data: { durationSeconds: 61, height: 1080, width: 1920 },
          },
        }
      );
      expect((await run("video")).success).toBe(true);
      expect(fakes.opsCalled()).toEqual(["probe-media"]);
      expect(lastCall("updateCardMediaFacts")).toEqual({
        cardId: CARD_ID,
        duration: 61,
        height: 1080,
        width: 1920,
      });
    });

    test("reads only the palette of a GIF, even with a mismatched MIME type", async () => {
      const { colors, fakes, run } = setup(
        {
          ...video,
          fileMetadata: {
            fileName: "animation.gif",
            mimeType: "application/pdf",
          },
        },
        { "extract-animation-palette": { data: { palette: ["#00ff00"] } } }
      );
      expect(await run("video")).toEqual({
        mode: "completed",
        success: true,
        thumbnailGenerated: false,
      });
      expect(fakes.opsCalled()).toEqual(["extract-animation-palette"]);
      expect(colors()).toEqual([[{ hex: "#00ff00" }]]);
    });

    test("a GIF the renderer declines succeeds without colors", async () => {
      const { colors, run } = setup(
        { ...video, fileMetadata: { fileName: "a.gif" } },
        { "extract-animation-palette": { fallback: "UNSUPPORTED" } }
      );
      expect((await run("video")).success).toBe(true);
      expect(colors()).toEqual([]);
    });

    test("a busy renderer retries a GIF's palette", async () => {
      const { run } = setup(
        { ...video, fileMetadata: { fileName: "a.gif" } },
        { "extract-animation-palette": { throws: BUSY } }
      );
      await expect(run("video")).rejects.toThrow("renderables_retryable:");
    });
  });

  describe("documents", () => {
    const pdf = {
      fileKey: "users/x/cards/c/file/a.pdf",
      fileMetadata: { fileName: "a.pdf", mimeType: "application/pdf" },
      type: "document",
    };

    test("records the renderer's first page with its size", async () => {
      const { fakes, lastCall, run } = setup(pdf, {
        inspect: { data: {} },
        "render-pdf-thumbnail": { data: { height: 1100, width: 850 } },
      });
      expect((await run("document")).thumbnailGenerated).toBe(true);
      const params = fakes.calls.find(
        (call) => call.op === "render-pdf-thumbnail"
      )?.params as Record<string, string>;
      expect(lastCall("updateCardThumbnail")).toEqual({
        cardId: CARD_ID,
        originalHeight: 1100,
        originalWidth: 850,
        thumbnailKey: params.destinationKey,
      });
    });

    test("fails without a retry for an encrypted or corrupt PDF", async () => {
      const { card, run } = setup(pdf, {
        "render-pdf-thumbnail": {
          fallback: "UNSUPPORTED",
          message: "encrypted",
        },
      });
      expect((await run("document")).success).toBe(false);
      expect(card?.processingStatus?.renderables).toMatchObject({
        error: "pdf_thumbnail_declined:unsupported:encrypted",
        status: "failed",
      });
    });

    test("a busy renderer retries the PDF page", async () => {
      const { run } = setup(pdf, { "render-pdf-thumbnail": { throws: BUSY } });
      await expect(run("document")).rejects.toThrow("renderables_retryable:");
    });

    test("an archive's preview facts are stored", async () => {
      const { lastCall, run } = setup(
        {
          ...pdf,
          fileMetadata: {
            fileName: "site.zip",
            mimeType: "application/zip",
          },
        },
        { inspect: { data: { facts: { entryCount: 12 } } } }
      );
      expect((await run("document")).success).toBe(true);
      expect(lastCall("updateCardFilePreview")).toEqual({
        cardId: CARD_ID,
        preview: { entryCount: 12 },
      });
    });

    test("a preview failure stays quiet", async () => {
      const { card, run } = setup(
        { ...pdf, fileMetadata: { fileName: "site.zip" } },
        { inspect: { throws: new Error("inspect failed") } }
      );
      expect((await run("document")).success).toBe(true);
      expect(card?.processingStatus?.renderables?.status).toBe("completed");
    });
  });

  describe("the stage", () => {
    test("is sent alone, so a parallel metadata write survives", async () => {
      const { convex, run } = setup({ type: "text" });
      await run("text");
      const sent = convex.callsTo("ai/mutations:updateCardProcessing").at(-1)
        ?.args.processingStatus;
      expect(Object.keys(sent as object)).toEqual(["renderables"]);
    });

    test.each(["text", "link", "quote", "palette", "audio"])(
      "a %s card renders nothing and completes",
      async (type) => {
        const { card, fakes, run } = setup({
          fileKey: "users/x/cards/c/file/x",
          type,
        });
        expect((await run(type)).success).toBe(true);
        expect(fakes.calls).toEqual([]);
        expect(card?.processingStatus?.renderables?.status).toBe("completed");
      }
    );

    test("a card deleted before the save reports no failure", async () => {
      const { run } = setup(
        { fileKey: "users/x/cards/c/file/a.png", type: "image" },
        { "analyze-image": { fallback: "UNSUPPORTED" } },
        { "ai/mutations:updateCardProcessing": () => false }
      );
      expect(await run("image")).toEqual({
        mode: "skipped",
        success: true,
        thumbnailGenerated: false,
      });
    });
  });
});

describe("image palette", () => {
  const image = {
    fileKey: "users/x/cards/c/file/a.png",
    type: "image",
  };

  test("stores the palette and size of an image without colors", async () => {
    const { colors, lastCall, runPalette } = setup(image, {
      "analyze-image": {
        data: { height: 300, palette: ["#123456"], width: 400 },
      },
    });
    await runPalette();
    expect(colors()).toEqual([[{ hex: "#123456" }]]);
    expect(lastCall("updateCardFileMetadata")).toEqual({
      cardId: CARD_ID,
      height: 300,
      width: 400,
    });
  });

  test.each([
    ["colors already", { colors: [{ hex: "#000000" }] }],
    ["a known tiny size", { fileMetadata: { height: 2, width: 2 } }],
  ])("leaves an image with %s alone", async (_name, fields) => {
    const { fakes, runPalette } = setup({ ...image, ...fields });
    await runPalette();
    expect(fakes.calls).toEqual([]);
  });

  test("swallows an analysis failure", async () => {
    const { colors, runPalette } = setup(image, {
      "analyze-image": { throws: new Error("images binding failed") },
    });
    await runPalette();
    expect(colors()).toEqual([]);
  });
});
