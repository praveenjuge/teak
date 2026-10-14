// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";

let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let paletteAnswer: () => Promise<unknown>;
let extractAnimationPalette: any;

beforeAll(async () => {
  mock.module(
    import.meta.resolve("../../../../storage/filesWorkerClient"),
    () => ({
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        workerCalls.push(spec);
        return paletteAnswer();
      },
      isFilesWorkerConfigured: () => true,
    })
  );
  extractAnimationPalette = (
    await import(
      "../../../../workflows/steps/renderables/extractAnimationPalette"
    )
  ).extractAnimationPalette;
});

beforeEach(() => {
  workerCalls = [];
});

const gifCard = {
  _id: "card-gif",
  userId: "user-1",
  type: "video",
  fileKey: "users/u/cards/c/file/loop.gif",
  fileMetadata: { mimeType: "image/gif", width: 320, height: 240 },
};

const run = async (card: Record<string, unknown> | null = gifCard) => {
  const updates: any[] = [];
  const ctx = {
    runQuery: () => Promise.resolve(card),
    runMutation: (ref: any, args: any) => {
      updates.push({ name: getFunctionName(ref), args });
      return Promise.resolve(null);
    },
  };
  const result = await extractAnimationPalette(ctx, { cardId: "card-gif" });
  return { result, updates };
};

describe("extractAnimationPalette", () => {
  test("stores the colors read across the GIF", async () => {
    paletteAnswer = () =>
      Promise.resolve({
        kind: "ok",
        data: { palette: ["#FB0000", "#0000FF"] },
      });
    const { result, updates } = await run();

    expect(result).toEqual({ generated: false, success: true });
    expect(workerCalls).toEqual([
      {
        op: "extract-animation-palette",
        params: { sourceKey: gifCard.fileKey },
      },
    ]);
    expect(updates).toEqual([
      {
        name: "workflows/aiMetadata/mutations:updateCardColors",
        args: {
          cardId: "card-gif",
          colors: [{ hex: "#FB0000" }, { hex: "#0000FF" }],
        },
      },
    ]);
  });

  test("succeeds without colors when the renderer declines the GIF", async () => {
    paletteAnswer = () =>
      Promise.resolve({
        kind: "fallback",
        code: "UNSUPPORTED",
        message: "renderer_declined:unsupported",
      });
    const { result, updates } = await run();

    expect(result).toEqual({ generated: false, success: true });
    expect(updates).toEqual([]);
  });

  test("asks for a retry when the renderer is busy or unavailable", async () => {
    paletteAnswer = () =>
      Promise.reject(
        new Error("files_worker_error:RENDERER_UNAVAILABLE:503:req-1")
      );
    const { result, updates } = await run();

    expect(result).toMatchObject({ retryable: true, success: false });
    expect(updates).toEqual([]);
  });

  test.each([
    ["already has colors", { ...gifCard, colors: [{ hex: "#123456" }] }],
    [
      "is too small to read",
      { ...gifCard, fileMetadata: { width: 4, height: 4 } },
    ],
    ["is not a video card", { ...gifCard, type: "image" }],
    ["was deleted", null],
  ])("leaves a card that %s alone", async (_name, card) => {
    paletteAnswer = () =>
      Promise.resolve({ kind: "ok", data: { palette: ["#FB0000"] } });
    const { result, updates } = await run(card);

    expect(result).toEqual({ generated: false, success: true });
    expect(workerCalls).toEqual([]);
    expect(updates).toEqual([]);
  });
});
