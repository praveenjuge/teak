// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";

let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let renderAnswer: () => Promise<unknown>;
let generatePdfThumbnail: any;

beforeAll(async () => {
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
        return renderAnswer();
      },
      isFilesWorkerConfigured: () => true,
    })
  );
  generatePdfThumbnail = (
    await import("../../../../workflows/steps/renderables/generatePdfThumbnail")
  ).generatePdfThumbnail;
});

beforeEach(() => {
  workerCalls = [];
});

const pdfCard = {
  _id: "card-pdf",
  userId: "user-1",
  type: "document",
  fileKey: "users/u/cards/c/file/report.pdf",
  fileMetadata: { mimeType: "application/pdf" },
};

const run = async (card: Record<string, unknown> = pdfCard) => {
  const updates: any[] = [];
  const ctx = {
    runQuery: () => Promise.resolve(card),
    runMutation: (ref: any, args: any) => {
      if (getFunctionName(ref) !== "storage/ownership:registerObject") {
        updates.push(args);
      }
      return Promise.resolve(true);
    },
  };
  const result = await generatePdfThumbnail(ctx, { cardId: "card-pdf" });
  return { result, updates };
};

describe("generatePdfThumbnail", () => {
  test("records the renderer's first page with its size", async () => {
    renderAnswer = () =>
      Promise.resolve({
        kind: "ok",
        data: {
          height: 1600,
          storedBytes: 4096,
          storedContentType: "image/png",
          width: 1132,
        },
      });
    const { result, updates } = await run();

    expect(result).toEqual({
      generated: true,
      success: true,
      thumbnailKey: "users/u/cards/c/thumbnail/generated",
    });
    expect(workerCalls).toEqual([
      {
        op: "render-pdf-thumbnail",
        params: {
          destinationKey: "users/u/cards/c/thumbnail/generated",
          sourceKey: pdfCard.fileKey,
        },
      },
    ]);
    expect(updates).toEqual([
      {
        cardId: "card-pdf",
        originalHeight: 1600,
        originalWidth: 1132,
        thumbnailKey: "users/u/cards/c/thumbnail/generated",
      },
    ]);
  });

  test("fails without a retry for an encrypted or corrupt PDF", async () => {
    renderAnswer = () =>
      Promise.resolve({
        kind: "fallback",
        code: "UNSUPPORTED",
        message: "renderer_declined:unsupported:encrypted",
      });
    const { result, updates } = await run();

    expect(result).toMatchObject({ retryable: false, success: false });
    expect(result.error).toStartWith("pdf_thumbnail_declined:unsupported:");
    expect(updates).toEqual([]);
  });

  test("asks for a retry when the renderer is unavailable", async () => {
    renderAnswer = () =>
      Promise.reject(
        new Error("files_worker_error:RENDERER_UNAVAILABLE:503:r")
      );
    const { result } = await run();

    expect(result).toMatchObject({ retryable: true, success: false });
  });

  test("skips non-PDF documents without calling the Worker", async () => {
    const { result, updates } = await run({
      ...pdfCard,
      fileMetadata: { mimeType: "application/msword" },
    });

    expect(result).toEqual({ generated: false, success: true });
    expect(workerCalls).toEqual([]);
    expect(updates).toEqual([]);
  });
});
