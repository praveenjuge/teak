import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { asFetch, testId } from "../../helpers/convex.test-utils";
import { r2MockModuleFactory, r2Mocks } from "../../helpers/r2Mock.test-utils";

mock.module("../../../../convex/storage/r2", r2MockModuleFactory);

// Mock internal API
import { internal } from "../../../../convex/_generated/api";

const originalFetch = global.fetch;
const mockFetch = mock();
global.fetch = asFetch(mockFetch);

import { validate } from "convex-helpers/validators";
import { aiMetadataResultValidator } from "../../../../convex/workflows/aiMetadata/schemas";
import {
  buildLinkContentParts,
  generateHandler,
  resolveImageAnalysisKey,
} from "../../../../convex/workflows/steps/metadata";

afterAll(() => {
  global.fetch = originalFetch;
  if (originalFilesBase === undefined) {
    delete process.env.FILES_BASE;
  } else {
    process.env.FILES_BASE = originalFilesBase;
  }
  if (originalFilesSecret === undefined) {
    delete process.env.FILES_SIGNING_SECRET;
  } else {
    process.env.FILES_SIGNING_SECRET = originalFilesSecret;
  }
});

const CARD_ID = testId("cards", "c1");
const originalFilesBase = process.env.FILES_BASE;
const originalFilesSecret = process.env.FILES_SIGNING_SECRET;

const TEXT_AI_OPS = new Set([
  "generate-text-metadata",
  "generate-link-metadata",
]);

// Fake Files Worker: text/link metadata ops answer with `aiResult` (or the
// `aiError` code); every other op answers with the `enableWorkerOp` envelope.
let aiResult: { tags: string[]; summary: string } = {
  tags: ["tag1"],
  summary: "summary",
};
let aiError: "AI_CAPACITY" | "AI_INVALID_OUTPUT" | null = null;
let workerOp: { data: unknown; status: number } = { data: null, status: 404 };

const envelope = (body: unknown, status: number) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const fakeWorker = (_url: unknown, init?: { body?: string }) => {
  const { op } = JSON.parse(init?.body ?? "{}");
  if (TEXT_AI_OPS.has(op)) {
    if (aiError) {
      return envelope(
        {
          error: {
            code: aiError,
            message: "Worker AI failed",
            requestId: "r1",
            retryable: true,
            aiFacts: { validationRetryCount: 2 },
          },
          ok: false,
          version: 1,
        },
        aiError === "AI_CAPACITY" ? 429 : 502
      );
    }
    return envelope(
      {
        data: { ...aiResult, validationRetryCount: 0 },
        ok: true,
        requestId: "r1",
        version: 1,
      },
      200
    );
  }
  return workerOp.status === 200
    ? envelope(
        { data: workerOp.data, ok: true, requestId: "r1", version: 1 },
        200
      )
    : envelope(
        {
          error: {
            code: "NOT_FOUND",
            message: "missing",
            requestId: "r1",
            retryable: false,
          },
          ok: false,
          version: 1,
        },
        workerOp.status
      );
};

/**
 * Return the signed Files Worker operation envelope for media processing.
 */
const enableWorkerOp = (data: unknown, { status = 200 } = {}) => {
  workerOp = { data, status };
};

const workerOps = (): string[] =>
  mockFetch.mock.calls.map(
    (call) => JSON.parse((call[1] as { body?: string })?.body ?? "{}").op
  );

const firstWorkerOpRequest = (): {
  op: string;
  params: Record<string, unknown>;
} => {
  const init = mockFetch.mock.calls.at(0)?.[1] as { body?: string };
  return JSON.parse(init?.body ?? "{}");
};

const WAVEFORM = {
  detail: Array.from({ length: 200 }, () => 50),
  grid: Array.from({ length: 45 }, () => 50),
};

/** A process-audio answer with a completed transcript. */
const processedAudio = (text: string, durationSeconds = 3) => ({
  facts: {
    container: "mp3",
    durationSeconds,
    hasAudio: true,
    hasVideo: false,
    height: null,
    videoCodec: null,
    width: null,
  },
  peaks: WAVEFORM,
  transcript: { status: "completed", text },
});

const lastWorkerOpRequest = (): {
  op: string;
  params: Record<string, unknown>;
} => {
  const init = mockFetch.mock.calls.at(-1)?.[1] as { body?: string };
  return JSON.parse(init?.body ?? "{}");
};

describe("metadata builds link content parts", () => {
  test("handles full metadata", () => {
    const card = {
      metadata: {
        linkPreview: {
          status: "success",
          title: "T",
          description: "D",
          author: "A",
          publisher: "P",
          publishedAt: "Date",
        },
      },
    };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("Title: T");
    expect(parts).toContain("Description: D");
    expect(parts).toContain("Author: A");
    expect(parts).toContain("Publisher: P");
    expect(parts).toContain("Published: Date");
  });

  test("falls back to URL if no metadata", () => {
    const card = { url: "https://example.com" };
    const parts = buildLinkContentParts(card);
    expect(parts).toEqual(["URL: https://example.com"]);
  });

  test("handles metadata with missing title", () => {
    const card = {
      url: "https://example.com",
      metadata: {
        linkPreview: {
          status: "success",
          description: "Description only",
        },
      },
    };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("Description: Description only");
  });

  test("handles empty link preview", () => {
    const card = {
      url: "https://example.com",
      metadata: {
        linkPreview: {
          status: "success",
        },
      },
    };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("URL: https://example.com");
  });

  test("uses content when URL is missing", () => {
    const card = { content: "https://fallback.com" };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("URL: https://fallback.com");
  });
});

describe("resolveImageAnalysisKey", () => {
  test("always prefers the bounded thumbnail", () => {
    expect(
      resolveImageAnalysisKey({
        fileKey: "original",
        thumbnailKey: "thumbnail",
      })
    ).toBe("thumbnail");
  });

  test("uses the original key for any image large enough to analyze", () => {
    expect(
      resolveImageAnalysisKey({
        fileKey: "small",
        fileMetadata: { height: 400, width: 400 },
      })
    ).toBe("small");
    expect(
      resolveImageAnalysisKey({
        fileKey: "large",
        fileMetadata: { height: 6000, width: 6000 },
      })
    ).toBe("large");
    expect(
      resolveImageAnalysisKey({
        fileKey: "tiny",
        fileMetadata: { height: 1, width: 1 },
        thumbnailKey: "tiny-thumbnail",
      })
    ).toBeUndefined();
  });
});

describe("metadata handler", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const mockScheduler = { runAfter: mock() };
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
    scheduler: mockScheduler,
  } as any;

  const expectSaved = (aiTags: string[], aiSummary: string) => {
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.workflows.aiMetadata.mutations.updateCardAI,
      expect.objectContaining({ cardId: CARD_ID, aiTags, aiSummary })
    );
  };

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    r2Mocks.resolveImageUrl.mockReset();
    r2Mocks.resolveImageUrl.mockImplementation((key: string) =>
      r2Mocks.resolveObjectUrl(key)
    );
    r2Mocks.resolveObjectUrl.mockReset();
    mockScheduler.runAfter.mockReset();
    mockFetch.mockReset();
    process.env.FILES_BASE = "https://files.teakvault.com";
    process.env.FILES_SIGNING_SECRET = "test-signing-secret";
    aiResult = { tags: ["tag1"], summary: "summary" };
    aiError = null;
    workerOp = { data: null, status: 404 };
    mockFetch.mockImplementation(fakeWorker);

    // Set up default mock returns
    mockRunMutation.mockResolvedValue(true);
  });

  describe("error handling", () => {
    test("skips if card was deleted before metadata generation", async () => {
      mockRunQuery.mockResolvedValue(null);
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });
      expect(result.mode).toBe("skipped");
    });

    test("completes without retry when there is no AI input", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "" });
      aiResult = { tags: [], summary: "" };
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });
      expect(result.mode).toBe("skipped");
    });

    test("uses the URL while optional link enrichment is pending", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadataStatus: "pending",
        metadata: {},
      });
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "link",
      });
      expect(result.mode).toBe("completed");
      expect(result.aiTagsCount).toBe(1);
    });

    test("defers metadata when provider capacity is exhausted", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "content" });
      aiError = "AI_CAPACITY";

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(result.mode).toBe("skipped");
      expect(mockRunMutation).not.toHaveBeenCalled();
    });

    test("defers metadata after bounded empty-output retries", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "content" });
      aiError = "AI_INVALID_OUTPUT";

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(result.mode).toBe("skipped");
      // The Worker spends the bounded validation retries; Convex calls once.
      expect(workerOps()).toEqual(["generate-text-metadata"]);
      expect(mockRunMutation).not.toHaveBeenCalled();
    });

    test.each(["FILES_BASE", "FILES_SIGNING_SECRET"])(
      "defers metadata without a request when %s is not configured",
      async (name) => {
        mockRunQuery.mockResolvedValue({ _id: "c1", content: "content" });
        delete process.env[name];

        const result = await generateHandler(ctx, {
          cardId: CARD_ID,
          cardType: "text",
        });

        // Returning instead of throwing keeps the step out of the workflow
        // retry budget; metadata stays pending for the backfill.
        expect(result.mode).toBe("skipped");
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockRunMutation).not.toHaveBeenCalled();
      }
    );

    test("keeps image metadata retryable when the worker declines the source", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { height: 1722, width: 3006 },
      });
      // A worker fallback surfaces as the deferred raster-pending condition.
      enableWorkerOp(null, { status: 404 });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });

      expect(result.mode).toBe("skipped");
      expect(mockRunMutation).not.toHaveBeenCalled();
    });
  });

  describe("AI backfill workflow result", () => {
    test("the workflow accepts what the step returns, so backfill runs are not recorded as failed", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "hello" });
      const completed = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });
      mockRunQuery.mockResolvedValue(null);
      const skipped = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(completed.mode).toBe("completed");
      expect(validate(aiMetadataResultValidator, completed)).toBe(true);
      expect(validate(aiMetadataResultValidator, skipped)).toBe(true);
    });
  });

  describe("text card metadata", () => {
    test("generates metadata for text card", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "hello world" });
      aiResult = { tags: ["greeting"], summary: "A greeting" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(result.hasSummary).toBe(true);
      expect(result.confidence).toBe(0.95);
      expectSaved(["greeting"], "A greeting");
    });

    test("saves AI tags trimmed, lowercased and without duplicates", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "word word" });
      aiResult = {
        tags: ["word", " Word ", "WORD", "", "design", "design"],
        summary: "Words",
      };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(result.aiTagsCount).toBe(2);
      expectSaved(["word", "design"], "Words");
    });

    test("handles empty text content", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "" });
      aiResult = { tags: [], summary: "" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });
      expect(result.mode).toBe("skipped");
    });
  });

  describe("image card metadata", () => {
    test("generates metadata via the worker op for raster image", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { mimeType: "image/png" },
      });
      enableWorkerOp({ summary: "A photo", tags: ["photo"] });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(result.confidence).toBe(0.9);
      expectSaved(["photo"], "A photo");
      expect(lastWorkerOpRequest().op).toBe("generate-image-metadata");
      expect(lastWorkerOpRequest().params.sourceKey).toBe("t1");
    });

    test("de-duplicates tags from the image worker", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { mimeType: "image/png" },
      });
      enableWorkerOp({ summary: "A photo", tags: ["Photo", "photo", "sky"] });

      await generateHandler(ctx, { cardId: CARD_ID, cardType: "image" });

      expectSaved(["photo", "sky"], "A photo");
    });

    test("uses thumbnail key as the worker source for SVG files", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { mimeType: "image/svg+xml" },
      });
      enableWorkerOp({ summary: "SVG image", tags: ["svg"] });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(lastWorkerOpRequest().params.sourceKey).toBe("t1");
    });

    test("passes the original key to the worker for a large image without a thumbnail", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        fileMetadata: { height: 6000, mimeType: "image/png", width: 6000 },
      });
      enableWorkerOp({ summary: "A large photo", tags: ["photo"] });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(lastWorkerOpRequest().params.sourceKey).toBe("f1");
    });

    test("detects SVG by file extension", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { fileName: "diagram.svg" },
      });
      enableWorkerOp({ summary: "A diagram", tags: ["diagram"] });

      await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });

      expect(lastWorkerOpRequest().params.sourceKey).toBe("t1");
    });

    test("handles uppercase SVG extension", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { fileName: "diagram.SVG" },
      });
      enableWorkerOp({ summary: "A diagram", tags: ["diagram"] });

      await generateHandler(ctx, { cardId: CARD_ID, cardType: "image" });

      expect(lastWorkerOpRequest().params.sourceKey).toBe("t1");
    });

    test("handles missing image file", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue(null);

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });
      expect(result.mode).toBe("skipped");
    });

    test("skips a known tiny original even if a thumbnail key exists", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        fileMetadata: { height: 1, width: 1 },
        thumbnailKey: "t1",
      });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "image",
      });

      expect(result.mode).toBe("skipped");
      expect(r2Mocks.resolveObjectUrl).not.toHaveBeenCalled();
      expect(workerOps()).toEqual([]);
    });
  });

  describe("video card metadata", () => {
    test("generates metadata from video thumbnail via worker op", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        thumbnailKey: "t1",
      });
      enableWorkerOp({ summary: "Video content", tags: ["video"] });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "video",
      });

      expect(result.aiTagsCount).toBe(1);
      expectSaved(["video"], "Video content");
      expect(result.confidence).toBe(0.88);
      expect(lastWorkerOpRequest().params.sourceKey).toBe("t1");
    });

    test("includes filename in video analysis title", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        thumbnailKey: "t1",
        fileMetadata: { fileName: "movie.mp4" },
      });
      enableWorkerOp({ summary: "A movie", tags: ["movie"] });

      await generateHandler(ctx, { cardId: CARD_ID, cardType: "video" });

      expect(String(lastWorkerOpRequest().params.title)).toContain("movie.mp4");
    });
  });

  describe("audio card metadata", () => {
    test("persists a long transcript without copying customer content into the journal", async () => {
      const transcript = "spoken text ".repeat(4000);
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "users/u/audio.mp3",
        processingStatus: { classify: { status: "completed" } },
      });
      enableWorkerOp(processedAudio(transcript));
      aiResult = { tags: ["speech"], summary: "Audio content" };
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "audio",
      });
      expect(mockRunMutation.mock.calls.at(-1)?.[1]).toMatchObject({
        aiTranscript: transcript,
        aiTags: ["speech"],
        aiSummary: "Audio content",
        processingStatus: {
          metadata: { status: "completed" },
        },
      });
      expect(result).toEqual({
        aiTagsCount: 1,
        hasSummary: true,
        hasTranscript: true,
        confidence: 0.85,
        mode: "completed",
      });
      expect(JSON.stringify(result).length).toBeLessThan(256);
    });

    test("generates metadata from audio transcript", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "users/u/audio.mp3",
        fileMetadata: { mimeType: "audio/mp3" },
      });
      enableWorkerOp(processedAudio("spoken text in audio"));
      aiResult = { tags: ["speech"], summary: "Audio content" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "audio",
      });

      expect(result.hasTranscript).toBe(true);
      expect(result.aiTagsCount).toBe(1);
      expectSaved(["speech"], "Audio content");
      expect(result.confidence).toBe(0.85);
      expect(workerOps()).toEqual(["process-audio", "generate-text-metadata"]);
      expect(firstWorkerOpRequest()).toMatchObject({
        op: "process-audio",
        params: {
          mimeType: "audio/mp3",
          sourceKey: "users/u/audio.mp3",
          transcribe: true,
        },
      });
    });

    test.each([
      ["punctuation only", ".", undefined],
      ["whitespace only", "   ", undefined],
      ["a Whisper closing phrase on a short clip", "Thank you.", 3],
    ])(
      "stores no transcript, summary or tags for %s",
      async (_label, text, duration) => {
        mockRunQuery.mockResolvedValue({
          _id: "c1",
          fileKey: "users/u/tone.wav",
          fileMetadata: { mimeType: "audio/wav", duration },
        });
        enableWorkerOp(processedAudio(text));

        const result = await generateHandler(ctx, {
          cardId: CARD_ID,
          cardType: "audio",
        });

        expect(result).toMatchObject({
          aiTagsCount: 0,
          hasSummary: false,
          hasTranscript: false,
        });
        expect(workerOps()).not.toContain("generate-text-metadata");
        const saved = mockRunMutation.mock.calls.at(-1)?.[1];
        expect(saved.aiTranscript).toBeUndefined();
        expect(saved.aiSummary).toBeUndefined();
        expect(saved.aiTags).toEqual([]);
        expect(saved.processingStatus.metadata.status).toBe("completed");
      }
    );

    test("keeps a closing phrase spoken in a long recording", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "users/u/talk.mp3",
        fileMetadata: { mimeType: "audio/mp3", duration: 600 },
      });
      enableWorkerOp(processedAudio("Thank you."));
      aiResult = { tags: ["talk"], summary: "Closing remarks" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "audio",
      });

      expect(result.hasTranscript).toBe(true);
      expect(mockRunMutation.mock.calls.at(-1)?.[1].aiTranscript).toBe(
        "Thank you."
      );
    });

    test("judges a closing phrase by the probed duration when the card has none", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "users/u/talk.mp3",
        fileMetadata: { mimeType: "audio/mp3" },
      });
      enableWorkerOp(processedAudio("Thank you.", 600));
      aiResult = { tags: ["talk"], summary: "Closing remarks" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "audio",
      });

      expect(result.hasTranscript).toBe(true);
      expect(mockRunMutation.mock.calls.at(-1)?.[1].aiTranscript).toBe(
        "Thank you."
      );
    });

    test("records the waveform and keeps going when the audio has no transcript", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "users/u/memo.ogg",
        fileMetadata: { mimeType: "audio/ogg" },
      });
      enableWorkerOp({
        ...processedAudio("", 12),
        transcript: { reason: "audio_decode_failed", status: "failed" },
      });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "audio",
      });

      expect(result.hasTranscript).toBe(false);
      expect(
        mockRunMutation.mock.calls.find(
          (call) => call[1]?.waveform !== undefined
        )?.[1]
      ).toEqual({ cardId: CARD_ID, duration: 12, waveform: WAVEFORM });
    });

    test("handles missing audio file", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "users/u/audio.wav",
        fileMetadata: { mimeType: "audio/wav" },
      });
      enableWorkerOp(null, { status: 404 });

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "audio",
      });
      expect(result.mode).toBe("skipped");
    });
  });

  describe("link card metadata", () => {
    test("generates metadata for link with preview", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadata: {
          linkPreview: {
            status: "success",
            title: "Example Site",
            description: "An example website",
          },
        },
      });
      aiResult = { tags: ["website"], summary: "Web content" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "link",
      });

      expect(result.aiTagsCount).toBe(1);
      expectSaved(["website"], "Web content");
      expect(result.confidence).toBe(0.9);
    });

    test("schedules screenshot for link cards", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success", title: "Site" } },
      });
      aiResult = { tags: ["link"], summary: "link sum" };

      await generateHandler(ctx, { cardId: CARD_ID, cardType: "link" });

      expect(mockScheduler.runAfter).toHaveBeenCalledWith(
        0,
        internal.workflows.screenshot.startScreenshotWorkflow,
        { cardId: CARD_ID }
      );
    });

    test("handles link with incomplete metadata", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success" } },
      });
      aiResult = { tags: ["link"], summary: "Link summary" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "link",
      });

      expect(result.hasSummary).toBe(true);
    });
  });

  describe("document card metadata", () => {
    test("generates metadata for document with filename", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "Document content here",
        fileMetadata: { fileName: "report.pdf" },
      });
      aiResult = { tags: ["report"], summary: "A report" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "document",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(result.confidence).toBe(0.85);
    });

    test("handles document without filename", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "Just content",
      });
      aiResult = { tags: ["doc"], summary: "Document summary" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "document",
      });

      expect(result.aiTagsCount).toBe(1);
    });
  });

  describe("stored document text", () => {
    const pdfCard = {
      _id: "c1",
      userId: "u1",
      fileKey: "users/u1/cards/c1/file/report.pdf",
      fileMetadata: { fileName: "report.pdf", mimeType: "application/pdf" },
    };
    // Routes worker ops by name; a PUT is the text upload.
    const routeWorker = (
      answers: Record<string, unknown>,
      { putStatus = 200 }: { putStatus?: number } = {}
    ) =>
      mockFetch.mockImplementation((url: unknown, init?: any) => {
        if (init?.method === "PUT") {
          return putStatus === 200
            ? envelope(
                {
                  data: { etag: "e", key: "k", size: 1 },
                  ok: true,
                  requestId: "r1",
                  version: 1,
                },
                200
              )
            : envelope(
                {
                  error: { code: "UPSTREAM", message: "down", retryable: true },
                  ok: false,
                  version: 1,
                },
                putStatus
              );
        }
        const { op } = JSON.parse(init?.body ?? "{}");
        if (op in answers) {
          const answer = answers[op] as { status?: number; data?: unknown };
          return answer.status && answer.status !== 200
            ? envelope(
                {
                  error: {
                    code: answer.status === 415 ? "UNSUPPORTED" : "BUSY",
                    message: "no",
                    requestId: "r1",
                    retryable: answer.status !== 415,
                  },
                  ok: false,
                  version: 1,
                },
                answer.status
              )
            : envelope(
                { data: answer.data, ok: true, requestId: "r1", version: 1 },
                200
              );
        }
        return fakeWorker(url, init);
      });
    const putUrls = () =>
      mockFetch.mock.calls
        .filter((call) => (call[1] as any)?.method === "PUT")
        .map((call) => decodeURIComponent(String(call[0])));
    const savedText = () =>
      mockRunMutation.mock.calls.find((call) =>
        String(call[1]?.key ?? "").includes("/document-text/")
      )?.[1];
    const savedAi = () =>
      mockRunMutation.mock.calls.find(
        (call) => "aiTranscript" in (call[1] ?? {})
      )?.[1];

    test("stores a PDF's text in R2 and its searchable prefix", async () => {
      mockRunQuery.mockResolvedValue(pdfCard);
      routeWorker({
        inspect: {
          data: {
            facts: { characterCount: 40, pageCount: 3 },
            text: "Kestrel Freight agreed to net 30 days.",
          },
        },
      });
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "document",
      });
      expect(putUrls()).toHaveLength(1);
      expect(putUrls()[0]).toMatch(/\/c1\/document-text\/[a-f0-9]{64}\.txt/);
      expect(savedText()).toMatchObject({
        cardId: CARD_ID,
        text: "Kestrel Freight agreed to net 30 days.",
        charCount: 38,
        truncated: false,
      });
      expect(result.mode).toBe("completed");
    });

    test("a PDF longer than the pages read is marked truncated", async () => {
      mockRunQuery.mockResolvedValue(pdfCard);
      routeWorker({
        inspect: { data: { facts: { pageCount: 900 }, text: "First pages" } },
      });
      await generateHandler(ctx, { cardId: CARD_ID, cardType: "document" });
      expect(savedText()).toMatchObject({ truncated: true });
    });

    test("a scan without a text layer stores nothing", async () => {
      mockRunQuery.mockResolvedValue(pdfCard);
      routeWorker({ inspect: { data: { facts: { pageCount: 2 }, text: "" } } });
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "document",
      });
      expect(putUrls()).toEqual([]);
      expect(savedText()).toBeUndefined();
      expect(result.mode).toBe("completed");
    });

    test("an upload failure keeps the step's tags and summary", async () => {
      mockRunQuery.mockResolvedValue(pdfCard);
      aiResult = { tags: ["freight"], summary: "A review" };
      routeWorker(
        { inspect: { data: { text: "Kestrel Freight" } } },
        { putStatus: 503 }
      );
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "document",
      });
      expect(savedText()).toBeUndefined();
      expectSaved(["freight"], "A review");
      expect(result.mode).toBe("completed");
    });

    const videoCard = {
      _id: "c1",
      userId: "u1",
      fileKey: "users/u1/cards/c1/file/clip.mp4",
      fileMetadata: { fileName: "clip.mp4", mimeType: "video/mp4" },
      thumbnailKey: "t1",
    };

    test("a video's speech becomes its transcript; its waveform stays off the card", async () => {
      mockRunQuery.mockResolvedValue(videoCard);
      routeWorker({
        "generate-image-metadata": {
          data: { summary: "A talk", tags: ["talk"] },
        },
        "process-audio": { data: processedAudio("welcome to the launch", 12) },
      });
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "video",
      });
      const processAudioCall = mockFetch.mock.calls.find((call) =>
        String((call[1] as any)?.body).includes("process-audio")
      );
      const processAudio = JSON.parse(
        (processAudioCall?.[1] as any)?.body ?? "{}"
      );
      expect(processAudio.params).toMatchObject({
        sourceKey: "users/u1/cards/c1/file/clip.mp4",
        transcribe: true,
      });
      expect(savedAi()).toMatchObject({
        aiTags: ["talk"],
        aiSummary: "A talk",
        aiTranscript: "welcome to the launch",
      });
      expect(
        mockRunMutation.mock.calls.some(
          (call) =>
            call[0] ===
            internal.workflows.steps.renderables.mutations.updateCardMediaFacts
        )
      ).toBe(false);
      expect(result.hasTranscript).toBe(true);
    });

    test("a silent or unreadable video keeps its thumbnail tags", async () => {
      for (const answer of [{ status: 415 }, { status: 503 }]) {
        mockRunMutation.mockClear();
        mockRunQuery.mockResolvedValue(videoCard);
        routeWorker({
          "generate-image-metadata": {
            data: { summary: "A clip", tags: ["clip"] },
          },
          "process-audio": answer,
        });
        const result = await generateHandler(ctx, {
          cardId: CARD_ID,
          cardType: "video",
        });
        expect(result).toMatchObject({
          hasTranscript: false,
          mode: "completed",
        });
        expectSaved(["clip"], "A clip");
      }
    });

    test("a video without a thumbnail is described from its transcript", async () => {
      mockRunQuery.mockResolvedValue({ ...videoCard, thumbnailKey: undefined });
      aiResult = { tags: ["launch"], summary: "A launch talk" };
      routeWorker({
        "process-audio": { data: processedAudio("welcome to the launch", 12) },
      });
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "video",
      });
      expectSaved(["launch"], "A launch talk");
      expect(result.hasTranscript).toBe(true);
    });
  });

  describe("quote card metadata", () => {
    test("generates metadata for quote", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "To be or not to be",
      });
      aiResult = { tags: ["shakespeare"], summary: "Famous quote" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "quote",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(result.confidence).toBe(0.95);
    });

    test("handles quote with whitespace", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "  quoted text  ",
      });
      aiResult = { tags: ["quote"], summary: "Quote summary" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "quote",
      });

      expect(result.aiTagsCount).toBe(1);
    });
  });

  describe("palette card metadata", () => {
    test("generates metadata for palette with colors", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "My palette",
        colors: [
          { hex: "#ff0000", name: "Red" },
          { hex: "#00ff00", name: "Green" },
        ],
      });
      aiResult = { tags: ["colors"], summary: "Color palette" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "palette",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(result.confidence).toBe(0.9);
    });

    test("handles palette with unnamed colors", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        colors: [{ hex: "#ff0000" }, { hex: "#0000ff" }],
      });
      aiResult = { tags: ["palette"], summary: "Palette" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "palette",
      });

      expect(result.aiTagsCount).toBe(1);
    });

    test("handles palette without colors", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "Palette description",
      });
      aiResult = { tags: ["palette"], summary: "Summary" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "palette",
      });

      expect(result.aiTagsCount).toBe(1);
    });
  });

  describe("processing status updates", () => {
    test("does not report saved metadata or schedule a screenshot after a concurrent card deletion", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", url: "https://example.com" });
      mockRunMutation.mockResolvedValue(false);
      aiResult = { tags: ["link"], summary: "Summary" };
      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "link",
      });
      expect(result).toEqual({
        aiTagsCount: 0,
        hasSummary: false,
        hasTranscript: false,
        confidence: 0,
        mode: "skipped",
      });
      expect(mockScheduler.runAfter).not.toHaveBeenCalled();
    });

    test("updates processing status with metadata stage", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "test",
        processingStatus: { classify: { status: "completed" } },
      });
      aiResult = { tags: ["test"], summary: "Test summary" };

      await generateHandler(ctx, { cardId: CARD_ID, cardType: "text" });

      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          cardId: CARD_ID,
          processingStatus: expect.objectContaining({
            metadata: expect.objectContaining({
              status: "completed",
            }),
          }),
        })
      );
    });

    test("sends only its own stage so a stale renderables copy cannot reset a parallel completion", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "test",
        processingStatus: {
          classify: { status: "completed", confidence: 0.9 },
          renderables: { status: "pending" },
        },
      });
      aiResult = { tags: ["test"], summary: "Summary" };

      await generateHandler(ctx, { cardId: CARD_ID, cardType: "text" });

      const sent = mockRunMutation.mock.calls.at(-1)?.[1].processingStatus;
      expect(Object.keys(sent)).toEqual(["metadata"]);
      expect(sent.metadata.status).toBe("completed");
    });
  });

  describe("edge cases", () => {
    test("handles undefined aiSummary", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "test" });
      aiResult = { tags: ["tag1"], summary: "" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(result.aiTagsCount).toBe(1);
      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          aiSummary: undefined,
        })
      );
    });

    test("handles undefined aiTags", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "test" });
      aiResult = { tags: [], summary: "Summary only" };

      const result = await generateHandler(ctx, {
        cardId: CARD_ID,
        cardType: "text",
      });

      expect(result.hasSummary).toBe(true);
      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          aiTags: undefined,
        })
      );
    });
  });
});
