import { beforeEach, describe, expect, test } from "bun:test";
import { resolveImageAnalysisKey } from "@teak/convex/shared/imageAnalysis";
import type { FilesOp } from "@teak/files-protocol";
import {
  CARD_ID,
  createCardConvex,
  createFakeOps,
  createMemoryBucket,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import { TEST_CONVEX_SITE_URL } from "../../test/fakeConvex";
import type { FilesOpCaller } from "../deps";
import { callFilesOp } from "../filesOps";
import { createWorkflowTelemetry, type WorkflowTelemetry } from "../telemetry";
import {
  buildLinkContentParts,
  generateCardMetadata,
  type MetadataOptions,
} from "./metadata";

// AI metadata, as card processing and the AI backfill run it. The text and
// link ops run for real against a fake Workers AI binding; the other ops
// (images, audio, documents) answer from fakes.

const WAVEFORM = {
  detail: Array.from({ length: 200 }, () => 50),
  grid: Array.from({ length: 45 }, () => 50),
};

const processedAudio = (text: string, durationSeconds = 3) => ({
  data: {
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
  },
});

let aiResult: { summary: string; tags: string[] };
let aiError: "capacity" | "invalid" | null;
let aiPrompts: string[];
let dataPoints: AnalyticsEngineDataPoint[];

const workersAi = {
  run: (_model: string, input: { messages: Array<{ content: string }> }) => {
    aiPrompts.push(input.messages.at(-1)?.content ?? "");
    if (aiError === "capacity") {
      return Promise.reject(
        Object.assign(new Error("Capacity temporarily exceeded"), {
          code: 3040,
        })
      );
    }
    return Promise.resolve({
      response:
        aiError === "invalid" ? "not json at all" : JSON.stringify(aiResult),
      usage: { completion_tokens: 30, prompt_tokens: 120 },
    });
  },
};

const DEFER: MetadataOptions = {
  capacity: "defer",
  restorePendingOnDefer: false,
};

const setup = (
  fields: Partial<FakeCard> | null,
  answers: Partial<Record<FilesOp, OpAnswer>> = {},
  envFields: Partial<Parameters<typeof testEnv>[0]> = {},
  handlers: Parameters<typeof createCardConvex>[1] = {}
) => {
  const card = fields ? makeCard({ content: "", ...fields }) : null;
  const convex = createCardConvex(card, handlers);
  const fakes = createFakeOps(answers);
  const env = testEnv({
    AI: workersAi as never,
    AI_USAGE: {
      writeDataPoint: (point: AnalyticsEngineDataPoint) => {
        dataPoints.push(point);
      },
    },
    ...envFields,
  });
  const ops: FilesOpCaller = (spec) =>
    spec.op === "generate-text-metadata" || spec.op === "generate-link-metadata"
      ? callFilesOp(env, spec)
      : fakes.ops(spec);
  const job = testJob(env, testDeps(env, convex.fetcher, ops));
  const generateWith = (
    telemetry: WorkflowTelemetry,
    cardType: string,
    options: MetadataOptions = DEFER
  ) => generateCardMetadata(job, telemetry, cardType, options);
  const generate = (cardType: string, options: MetadataOptions = DEFER) =>
    generateWith(createWorkflowTelemetry(env), cardType, options);
  const saved = () =>
    convex.callsTo("workflows/aiMetadata/mutations:updateCardAI").at(-1)?.args;
  return { card, convex, fakes, generate, generateWith, saved };
};

beforeEach(() => {
  aiResult = { summary: "summary", tags: ["tag1"] };
  aiError = null;
  aiPrompts = [];
  dataPoints = [];
});

describe("link content for the prompt", () => {
  test("uses every preview field", () => {
    const parts = buildLinkContentParts({
      metadata: {
        linkPreview: {
          author: "A",
          description: "D",
          publishedAt: "Date",
          publisher: "P",
          status: "success",
          title: "T",
        },
      },
    });
    expect(parts).toEqual([
      "Title: T",
      "Description: D",
      "Author: A",
      "Publisher: P",
      "Published: Date",
    ]);
  });

  test.each([
    ["no preview", { url: "https://example.com" }, "URL: https://example.com"],
    [
      "an empty preview",
      {
        metadata: { linkPreview: { status: "success" } },
        url: "https://e.com",
      },
      "URL: https://e.com",
    ],
    [
      "no URL",
      { content: "https://fallback.com" },
      "URL: https://fallback.com",
    ],
  ])("falls back to the URL with %s", (_name, card, expected) => {
    expect(buildLinkContentParts(card)).toEqual([expected]);
  });
});

describe("resolveImageAnalysisKey", () => {
  test("prefers the bounded thumbnail", () => {
    expect(
      resolveImageAnalysisKey({ fileKey: "original", thumbnailKey: "thumb" })
    ).toBe("thumb");
  });

  test("uses the original for any image large enough, never a tiny one", () => {
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

describe("generating metadata", () => {
  test("a deleted card is skipped", async () => {
    const { generate } = setup(null);
    expect((await generate("text")).mode).toBe("skipped");
  });

  test("a text card's tags are saved trimmed, lowercased and once each", async () => {
    aiResult = {
      summary: "Words",
      tags: ["word", " Word ", "WORD", "", "design", "design"],
    };
    const { generate, saved } = setup({ content: "word word" });

    const result = await generate("text");

    expect(result).toEqual({
      aiTagsCount: 2,
      cardType: "text",
      confidence: 0.95,
      hasSummary: true,
      hasTranscript: false,
      mode: "completed",
    });
    expect(saved()).toMatchObject({
      aiSummary: "Words",
      aiTags: ["word", "design"],
      processingStatus: { metadata: { status: "completed" } },
    });
  });

  test("sends only its own stage, so a parallel renderables write survives", async () => {
    const { generate, saved } = setup({ content: "test" });
    await generate("text");
    expect(Object.keys(saved()?.processingStatus as object)).toEqual([
      "metadata",
    ]);
  });

  test("charges the call to the card's owner in AI usage", async () => {
    const { generate } = setup({ content: "hello" });
    await generate("text");
    expect(dataPoints).toHaveLength(1);
    expect(dataPoints[0]?.indexes).toEqual([USER_ID]);
    expect(dataPoints[0]?.blobs?.[0]).toBe(TEST_CONVEX_SITE_URL);
  });

  test("no AI output completes the stage without tags", async () => {
    aiResult = { summary: "", tags: [] };
    const { generate, saved } = setup({ content: "" });
    expect((await generate("text")).mode).toBe("skipped");
    expect(saved()).toMatchObject({
      aiTags: [],
      processingStatus: { metadata: { confidence: 0, status: "completed" } },
    });
  });

  test("a summary without tags stores no tags field", async () => {
    aiResult = { summary: "Summary only", tags: [] };
    const { generate, saved } = setup({ content: "test" });
    expect((await generate("text")).hasSummary).toBe(true);
    expect(saved()).not.toHaveProperty("aiTags");
  });

  test("AI turned off for the owner completes the stage with no AI call", async () => {
    const { generate, saved } = setup(
      { content: "private" },
      {},
      {},
      { "adminAccess:getAiGate": () => "user_disabled" }
    );
    expect((await generate("text")).mode).toBe("skipped");
    expect(aiPrompts).toEqual([]);
    expect(saved()).toMatchObject({
      aiTags: [],
      processingStatus: { metadata: { status: "completed" } },
    });
  });

  test("AI paused from the console defers without a call", async () => {
    const { generate, saved } = setup(
      { content: "paused" },
      {},
      {},
      { "adminAccess:getAiGate": () => "paused" }
    );
    expect((await generate("text")).mode).toBe("deferred");
    expect(aiPrompts).toEqual([]);
    expect(saved()).toBeUndefined();
  });

  describe("deferring to the backfill", () => {
    test("Workers AI capacity defers when the caller says so", async () => {
      aiError = "capacity";
      const { generate, saved } = setup({ content: "content" });
      expect((await generate("text")).mode).toBe("deferred");
      expect(saved()).toBeUndefined();
    });

    test("Workers AI capacity is rethrown for the step to retry", async () => {
      aiError = "capacity";
      const { generate } = setup({ content: "content" });
      await expect(
        generate("text", { capacity: "retry", restorePendingOnDefer: true })
      ).rejects.toThrow("files_worker_ai: rate limit reached 429");
    });

    test("output that never validates defers after the op's own retries", async () => {
      aiError = "invalid";
      const { generate, saved } = setup({ content: "content" });
      expect((await generate("text")).mode).toBe("deferred");
      expect(aiPrompts).toHaveLength(3);
      expect(saved()).toBeUndefined();
    });

    test("a deferral puts a stage the step marked back to pending", async () => {
      aiError = "invalid";
      const { card, generate } = setup({
        content: "content",
        processingStatus: { metadata: { status: "in_progress" } },
      });
      await generate("text", {
        capacity: "retry",
        restorePendingOnDefer: true,
      });
      expect(card?.processingStatus?.metadata?.status).toBe("pending");
    });

    test("a deferral leaves a stage that already finished as it is", async () => {
      aiError = "invalid";
      const { card, generate } = setup({
        content: "content",
        processingStatus: {
          metadata: { completedAt: 5, status: "completed" },
        },
      });
      await generate("text", {
        capacity: "retry",
        restorePendingOnDefer: true,
      });
      expect(card?.processingStatus?.metadata).toEqual({
        completedAt: 5,
        status: "completed",
      });
    });

    test("an image source the op declines defers like a pending thumbnail", async () => {
      const { generate, saved } = setup(
        {
          fileKey: "f1",
          fileMetadata: { height: 1722, width: 3006 },
          thumbnailKey: "t1",
        },
        { "generate-image-metadata": { fallback: "NOT_FOUND" } }
      );
      expect((await generate("image")).mode).toBe("deferred");
      expect(saved()).toBeUndefined();
    });
  });

  describe("images", () => {
    test.each([
      ["a raster image", { fileMetadata: { mimeType: "image/png" } }, "t1"],
      ["an SVG", { fileMetadata: { fileName: "diagram.SVG" } }, "t1"],
    ])("%s is described from its thumbnail", async (_name, fields, key) => {
      const { fakes, generate, saved } = setup(
        { fileKey: "f1", thumbnailKey: "t1", ...fields },
        {
          "generate-image-metadata": {
            data: { summary: "A photo", tags: ["Photo", "photo", "sky"] },
          },
        }
      );
      const result = await generate("image");
      expect(result.confidence).toBe(0.9);
      expect(fakes.calls.at(-1)?.params.sourceKey).toBe(key);
      expect(saved()).toMatchObject({
        aiSummary: "A photo",
        aiTags: ["photo", "sky"],
      });
    });

    test("a large image without a thumbnail is read from its original", async () => {
      const { fakes, generate } = setup(
        {
          fileKey: "f1",
          fileMetadata: { height: 6000, mimeType: "image/png", width: 6000 },
        },
        { "generate-image-metadata": { data: { summary: "Big", tags: ["x"] } } }
      );
      await generate("image");
      expect(fakes.calls.at(-1)?.params.sourceKey).toBe("f1");
    });

    describe("visual styles", () => {
      const imageCard = {
        fileKey: "f1",
        fileMetadata: { mimeType: "image/png" },
        thumbnailKey: "t1",
      };
      const clefStyles = (styles: string[]) => ({
        model: "@cf/cloudflare/clef-flash",
        styles,
        usage: { inputTokens: 400, outputTokens: 0 },
        version: 1,
      });
      const imageAnswer = (
        tags: string[],
        visualStyles?: unknown
      ): OpAnswer => ({
        data: {
          summary: "An image",
          tags,
          ...(visualStyles === undefined ? {} : { visualStyles }),
        },
      });
      const recordingTelemetry = () => {
        const events: Array<{ name: string; properties: unknown }> = [];
        const telemetry: WorkflowTelemetry = {
          flush: () => Promise.resolve(),
          record: (name, properties) => {
            events.push({ name, properties });
          },
        };
        return { events, telemetry };
      };

      test("asks the image op for Clef's styles and keeps them", async () => {
        const { fakes, generateWith, saved } = setup(imageCard, {
          "generate-image-metadata": imageAnswer(
            ["poster", "grayscale"],
            clefStyles(["typographic", "minimal"])
          ),
        });
        const { events, telemetry } = recordingTelemetry();
        await generateWith(telemetry, "image");
        expect(fakes.calls.at(-1)?.params.visualStyles).toBe(true);
        expect(saved()?.visualStyles).toEqual(["typographic", "minimal"]);
        expect(events).toEqual([
          {
            name: "$ai_generation",
            properties: expect.objectContaining({
              $ai_input_tokens: 400,
              $ai_is_error: false,
              $ai_model: "@cf/cloudflare/clef-flash",
              $ai_span_name: "teak.ai.decision.decide-visual-styles",
            }),
          },
        ]);
      });

      test("falls back to the tag aliases without a Clef reply", async () => {
        const { generate, saved } = setup(imageCard, {
          "generate-image-metadata": imageAnswer(["grayscale", "photo"]),
        });
        await generate("image");
        expect(saved()?.visualStyles).toEqual(["monochrome", "photographic"]);
      });

      test("falls back to the tag aliases for an invalid Clef reply", async () => {
        const { generate, saved } = setup(imageCard, {
          "generate-image-metadata": imageAnswer(
            ["grayscale"],
            clefStyles(["grunge"])
          ),
        });
        await generate("image");
        expect(saved()?.visualStyles).toEqual(["monochrome"]);
      });

      test("a confident 'no styles' from Clef saves none", async () => {
        const { generate, saved } = setup(imageCard, {
          "generate-image-metadata": imageAnswer(["grayscale"], clefStyles([])),
        });
        await generate("image");
        expect(saved()).toBeDefined();
        expect(saved()?.visualStyles).toBeUndefined();
      });

      test("styles alone still complete the stage with them", async () => {
        const { generate, saved } = setup(imageCard, {
          "generate-image-metadata": {
            data: {
              summary: "",
              tags: [],
              visualStyles: clefStyles(["abstract"]),
            },
          },
        });
        expect((await generate("image")).mode).toBe("completed");
        expect(saved()?.visualStyles).toEqual(["abstract"]);
      });

      test("videos keep styles from their thumbnail", async () => {
        const { fakes, generate, saved } = setup(
          { thumbnailKey: "t1" },
          {
            "generate-image-metadata": imageAnswer(
              ["trailer"],
              clefStyles(["cinematic", "dark"])
            ),
          }
        );
        await generate("video");
        expect(fakes.calls.at(-1)?.params.visualStyles).toBe(true);
        expect(saved()?.visualStyles).toEqual(["cinematic", "dark"]);
      });
    });

    test("a known tiny image is never sent", async () => {
      const { fakes, generate } = setup({
        fileKey: "f1",
        fileMetadata: { height: 1, width: 1 },
        thumbnailKey: "t1",
      });
      expect((await generate("image")).mode).toBe("skipped");
      expect(fakes.calls).toEqual([]);
    });
  });

  describe("video", () => {
    const videoCard = {
      fileKey: "users/x/cards/c/file/clip.mp4",
      fileMetadata: { fileName: "clip.mp4", mimeType: "video/mp4" },
      thumbnailKey: "t1",
    };

    test("its thumbnail is described, titled with the file name", async () => {
      const { fakes, generate, saved } = setup(videoCard, {
        "generate-image-metadata": {
          data: { summary: "A talk", tags: ["talk"] },
        },
        "process-audio": processedAudio("welcome to the launch", 12),
      });
      const result = await generate("video");
      expect(result).toMatchObject({ confidence: 0.88, hasTranscript: true });
      expect(
        fakes.calls.find((call) => call.op === "generate-image-metadata")
          ?.params
      ).toEqual({ sourceKey: "t1", title: "clip.mp4", visualStyles: true });
      expect(saved()).toMatchObject({
        aiSummary: "A talk",
        aiTags: ["talk"],
        aiTranscript: "welcome to the launch",
      });
    });

    test("its waveform and duration stay off the card", async () => {
      const { convex, generate } = setup(videoCard, {
        "generate-image-metadata": { data: { summary: "A", tags: ["a"] } },
        "process-audio": processedAudio("spoken words here", 12),
      });
      await generate("video");
      expect(
        convex.callsTo(
          "workflows/steps/renderables/mutations:updateCardMediaFacts"
        )
      ).toEqual([]);
    });

    test.each([
      ["undecodable audio", { fallback: "UNSUPPORTED" } as const],
      [
        "a busy renderer",
        { throws: new Error("files_worker_error:RENDERER_UNAVAILABLE:503:x") },
      ],
    ])("%s keeps the thumbnail's tags", async (_name, audio) => {
      const { generate, saved } = setup(videoCard, {
        "generate-image-metadata": {
          data: { summary: "A clip", tags: ["clip"] },
        },
        "process-audio": audio,
      });
      expect(await generate("video")).toMatchObject({
        hasTranscript: false,
        mode: "completed",
      });
      expect(saved()).toMatchObject({ aiTags: ["clip"] });
    });

    test("a video without a thumbnail is described from its transcript", async () => {
      aiResult = { summary: "A launch talk", tags: ["launch"] };
      const { generate, saved } = setup(
        { ...videoCard, thumbnailKey: undefined },
        { "process-audio": processedAudio("welcome to the launch", 12) }
      );
      expect((await generate("video")).confidence).toBe(0.85);
      expect(saved()).toMatchObject({ aiTags: ["launch"] });
    });
  });

  describe("audio", () => {
    test("its transcript is stored and described; the step returns facts only", async () => {
      const transcript = "spoken text ".repeat(4000);
      aiResult = { summary: "Audio content", tags: ["speech"] };
      const { fakes, generate, saved } = setup(
        {
          fileKey: "users/x/cards/c/file/a.mp3",
          fileMetadata: { mimeType: "audio/mp3" },
        },
        { "process-audio": processedAudio(transcript) }
      );
      const result = await generate("audio");
      expect(saved()).toMatchObject({
        aiSummary: "Audio content",
        aiTags: ["speech"],
        aiTranscript: transcript,
      });
      expect(result).toEqual({
        aiTagsCount: 1,
        cardType: "audio",
        confidence: 0.85,
        hasSummary: true,
        hasTranscript: true,
        mode: "completed",
      });
      expect(JSON.stringify(result).length).toBeLessThan(256);
      expect(fakes.calls[0]).toEqual({
        op: "process-audio",
        params: {
          mimeType: "audio/mp3",
          sourceKey: "users/x/cards/c/file/a.mp3",
          transcribe: true,
        },
      });
    });

    test.each([
      ["punctuation only", ".", undefined],
      ["whitespace only", "   ", undefined],
      ["a Whisper closing phrase on a short clip", "Thank you.", 3],
    ])(
      "%s stores no transcript, summary or tags",
      async (_n, text, duration) => {
        const { generate, saved } = setup(
          {
            fileKey: "users/x/cards/c/file/tone.wav",
            fileMetadata: { duration, mimeType: "audio/wav" },
          },
          { "process-audio": processedAudio(text) }
        );
        expect(await generate("audio")).toMatchObject({
          aiTagsCount: 0,
          hasTranscript: false,
        });
        expect(aiPrompts).toEqual([]);
        expect(saved()).toMatchObject({ aiTags: [] });
        expect(saved()).not.toHaveProperty("aiTranscript");
      }
    );

    test.each([
      ["the card's duration", { duration: 600 }, 3],
      ["the probed duration", {}, 600],
    ])(
      "keeps a closing phrase in a long recording, by %s",
      async (_n, meta, probed) => {
        const { generate, saved } = setup(
          {
            fileKey: "users/x/cards/c/file/talk.mp3",
            fileMetadata: { mimeType: "audio/mp3", ...meta },
          },
          { "process-audio": processedAudio("Thank you.", probed) }
        );
        expect((await generate("audio")).hasTranscript).toBe(true);
        expect(saved()?.aiTranscript).toBe("Thank you.");
      }
    );

    test("records the waveform when the audio has no transcript", async () => {
      const { convex, generate } = setup(
        {
          fileKey: "users/x/cards/c/file/memo.ogg",
          fileMetadata: { mimeType: "audio/ogg" },
        },
        {
          "process-audio": {
            data: {
              ...processedAudio("", 12).data,
              transcript: { reason: "audio_decode_failed", status: "failed" },
            },
          },
        }
      );
      expect((await generate("audio")).hasTranscript).toBe(false);
      expect(
        convex.callsTo(
          "workflows/steps/renderables/mutations:updateCardMediaFacts"
        )[0]?.args
      ).toEqual({ cardId: CARD_ID, duration: 12, waveform: WAVEFORM });
    });

    test("an audio file the op cannot find leaves the card without AI", async () => {
      const { generate } = setup(
        {
          fileKey: "users/x/cards/c/file/a.wav",
          fileMetadata: { mimeType: "audio/wav" },
        },
        { "process-audio": { fallback: "NOT_FOUND" } }
      );
      expect((await generate("audio")).mode).toBe("skipped");
    });

    test("an audio key outside the deployment's namespace is refused", async () => {
      const { generate } = setup({
        fileKey: "elsewhere/a.wav",
        fileMetadata: { mimeType: "audio/wav" },
      });
      await expect(generate("audio")).rejects.toThrow(
        "invalid_storage_key_namespace"
      );
    });
  });

  describe("links", () => {
    test("a link is described from its preview with the link prompt", async () => {
      aiResult = { summary: "Web content", tags: ["website"] };
      const { generate, saved } = setup({
        metadata: {
          linkPreview: {
            description: "An example website",
            status: "success",
            title: "Example Site",
          },
        },
        url: "https://example.com",
      });
      expect((await generate("link")).confidence).toBe(0.9);
      expect(aiPrompts[0]).toContain("Title: Example Site");
      expect(aiPrompts[0]).toContain("URL: https://example.com");
      expect(saved()).toMatchObject({ aiTags: ["website"] });
    });

    test("uses the URL while the preview is still pending", async () => {
      const { generate } = setup({
        metadata: {},
        metadataStatus: "pending",
        url: "https://example.com",
      });
      expect(await generate("link")).toMatchObject({
        aiTagsCount: 1,
        mode: "completed",
      });
    });

    test("a card deleted as it saves reports nothing saved", async () => {
      const { generate } = setup(
        { url: "https://example.com" },
        {},
        {},
        { "workflows/aiMetadata/mutations:updateCardAI": () => false }
      );
      expect((await generate("link")).mode).toBe("skipped");
    });
  });

  describe("documents", () => {
    const pdfCard = {
      fileKey: "users/x/cards/c/file/report.pdf",
      fileMetadata: { fileName: "report.pdf", mimeType: "application/pdf" },
    };

    test("a PDF's text is stored in R2 and its searchable prefix in Convex", async () => {
      const memory = createMemoryBucket();
      const { convex, generate } = setup(
        pdfCard,
        {
          inspect: {
            data: {
              facts: { characterCount: 40, pageCount: 3 },
              text: "Kestrel Freight agreed to net 30 days.",
            },
          },
        },
        { BUCKET: memory.bucket }
      );
      expect((await generate("document")).mode).toBe("completed");
      const [key] = [...memory.objects.keys()];
      expect(key).toMatch(
        new RegExp(`/${CARD_ID}/document-text/[a-f0-9]{64}\\.txt$`)
      );
      expect(memory.objects.get(key as string)).toBe(
        "Kestrel Freight agreed to net 30 days."
      );
      expect(
        convex.callsTo("storage/ownership:registerObject")[0]?.args
      ).toEqual({ key, userId: USER_ID });
      expect(
        convex.callsTo("card/documentText:saveDocumentText")[0]?.args
      ).toMatchObject({
        charCount: 38,
        key,
        text: "Kestrel Freight agreed to net 30 days.",
        truncated: false,
      });
      expect(aiPrompts[0]).toContain("report.pdf");
      expect(aiPrompts[0]).toContain("Kestrel Freight");
    });

    test("a PDF longer than the pages read is marked truncated", async () => {
      const { convex, generate } = setup(pdfCard, {
        inspect: { data: { facts: { pageCount: 900 }, text: "First pages" } },
      });
      await generate("document");
      expect(
        convex.callsTo("card/documentText:saveDocumentText")[0]?.args
      ).toMatchObject({ truncated: true });
    });

    test("a scan without a text layer stores nothing", async () => {
      const memory = createMemoryBucket();
      const { convex, generate } = setup(
        pdfCard,
        { inspect: { data: { facts: { pageCount: 2 }, text: "" } } },
        { BUCKET: memory.bucket }
      );
      expect((await generate("document")).mode).toBe("completed");
      expect(memory.objects.size).toBe(0);
      expect(convex.callsTo("card/documentText:saveDocumentText")).toEqual([]);
    });

    test("an R2 failure keeps the step's tags and summary", async () => {
      aiResult = { summary: "A review", tags: ["freight"] };
      const failing = {
        put: () => Promise.reject(new Error("r2 unavailable")),
      } as unknown as R2Bucket;
      const { convex, generate, saved } = setup(
        pdfCard,
        { inspect: { data: { text: "Kestrel Freight" } } },
        { BUCKET: failing }
      );
      expect((await generate("document")).mode).toBe("completed");
      expect(convex.callsTo("card/documentText:saveDocumentText")).toEqual([]);
      expect(saved()).toMatchObject({ aiTags: ["freight"] });
    });

    test("a document without a file is described from its content", async () => {
      const { generate } = setup({ content: "Just content" });
      expect(await generate("document")).toMatchObject({
        aiTagsCount: 1,
        confidence: 0.85,
      });
    });
  });

  describe("quotes and palettes", () => {
    test("a quote is described from its text", async () => {
      const { generate } = setup({ content: "  To be or not to be  " });
      expect((await generate("quote")).confidence).toBe(0.95);
    });

    test("a palette's named colors lead its prompt", async () => {
      const { generate } = setup({
        colors: [{ hex: "#ff0000", name: "Red" }, { hex: "#00ff00" }],
        content: "My palette",
      });
      expect((await generate("palette")).confidence).toBe(0.9);
      expect(aiPrompts[0]).toContain(
        "Colors: #ff0000 (Red), #00ff00\nMy palette"
      );
    });
  });
});
