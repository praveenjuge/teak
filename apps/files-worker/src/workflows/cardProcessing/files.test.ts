import { describe, expect, test } from "bun:test";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
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
} from "../../test/cardProcessingKit";
import { createWorkflowTelemetry } from "../telemetry";
import type { CardDoc } from "./context";
import {
  buildFilePreviewFactsForKey,
  extractFileTextForKey,
  processAudioCard,
  recordMediaFacts,
  transcribeStoredAudio,
} from "./files";
import {
  hasKnownTinyImageDimensions,
  hasMinimumImageAnalysisDimensions,
  MIN_IMAGE_ANALYSIS_DIMENSION,
} from "./imageAnalysisKey";

const setup = (
  fields: Partial<FakeCard>,
  answers: Partial<Record<FilesOp, OpAnswer>>
) => {
  const card = makeCard(fields);
  const convex = createCardConvex(card);
  const fakes = createFakeOps(answers);
  const env = testEnv();
  const job = testJob(env, testDeps(env, convex.fetcher, fakes.ops));
  const factWrites = () =>
    convex
      .callsTo("workflows/steps/renderables/mutations:updateCardMediaFacts")
      .map((call) => call.args);
  return { card: card as unknown as CardDoc, fakes, factWrites, job };
};

describe("recordMediaFacts", () => {
  test("stores a video's probed duration and display size", async () => {
    const { card, fakes, factWrites, job } = setup(
      { fileKey: "users/u/cards/c1/file/a.mov", fileMetadata: {} },
      {
        "probe-media": {
          data: {
            container: "mov",
            durationSeconds: 3.0004,
            hasAudio: false,
            hasVideo: true,
            height: 64,
            videoCodec: "avc1",
            width: 36,
          },
        },
      }
    );
    expect(await recordMediaFacts(job, card, "video")).toBe(3);
    expect(fakes.calls).toEqual([
      {
        op: "probe-media",
        params: { sourceKey: "users/u/cards/c1/file/a.mov" },
      },
    ]);
    expect(factWrites()).toEqual([
      { cardId: CARD_ID, duration: 3, height: 64, width: 36 },
    ]);
  });

  test("stores only the duration for audio", async () => {
    const { card, factWrites, job } = setup(
      { fileKey: "users/u/cards/c2/file/a.m4a" },
      {
        "probe-media": {
          data: { durationSeconds: 61.25, height: 10, width: 10 },
        },
      }
    );
    await recordMediaFacts(job, card, "audio");
    expect(factWrites()).toEqual([{ cardId: CARD_ID, duration: 61.25 }]);
  });

  test("skips the probe when the card already has every fact", async () => {
    const { card, fakes, job } = setup(
      {
        fileKey: "users/u/cards/c3/file/a.mp4",
        fileMetadata: { duration: 4, height: 2, width: 2 },
      },
      {}
    );
    expect(await recordMediaFacts(job, card, "video")).toBe(4);
    expect(fakes.calls).toEqual([]);
  });

  test.each([
    ["an unknown container", { fallback: "UNSUPPORTED" } as OpAnswer],
    [
      "a malformed answer",
      { data: { durationSeconds: "12", width: -1 } } as OpAnswer,
    ],
    ["a failed probe", { throws: new Error("files_worker_error:X:500:r") }],
  ])("leaves the card unchanged for %s", async (_name, answer) => {
    const { card, factWrites, job } = setup(
      { fileKey: "users/u/cards/c4/file/a.webm" },
      { "probe-media": answer }
    );
    await recordMediaFacts(job, card, "video");
    expect(factWrites()).toEqual([]);
  });
});

describe("audio transcription", () => {
  const AUDIO_KEY = "users/user_1/cards/c5/file/a.mp3";
  const processed: OpAnswer = {
    data: {
      facts: {
        container: "mp3",
        durationSeconds: 61.4,
        hasAudio: true,
        hasVideo: false,
        height: null,
        videoCodec: null,
        width: null,
      },
      peaks: {
        detail: Array.from({ length: 200 }, () => 50),
        grid: Array.from({ length: 45 }, () => 50),
      },
      transcript: { status: "completed", text: "Hello there." },
    },
  };

  test("transcribing stored audio writes no facts to the card", async () => {
    const { factWrites, fakes, job } = setup(
      { type: "link" },
      {
        "process-audio": processed,
      }
    );

    const { processed: result, text } = await transcribeStoredAudio(
      job,
      createWorkflowTelemetry(job.env),
      { mimeType: "audio/mpeg", sourceKey: AUDIO_KEY }
    );

    expect(text).toBe("Hello there.");
    expect(result?.facts.durationSeconds).toBe(61.4);
    expect(fakes.calls).toEqual([
      {
        op: "process-audio",
        params: {
          mimeType: "audio/mpeg",
          sourceKey: AUDIO_KEY,
          transcribe: true,
        },
      },
    ]);
    expect(factWrites()).toEqual([]);
  });

  test("an audio card still records its duration and waveform", async () => {
    const { card, factWrites, job } = setup(
      { fileKey: AUDIO_KEY, fileMetadata: { mimeType: "audio/mpeg" } },
      { "process-audio": processed }
    );

    const { transcript } = await processAudioCard(
      job,
      createWorkflowTelemetry(job.env),
      { card, keyPrefix: "" }
    );

    expect(transcript).toBe("Hello there.");
    expect(factWrites()).toEqual([
      expect.objectContaining({ cardId: CARD_ID, duration: 61.4 }),
    ]);
    expect(factWrites()[0]?.waveform).toBeDefined();
  });

  test("audio the renderer can't decode gives no result and no facts", async () => {
    const { factWrites, job } = setup(
      {},
      { "process-audio": { fallback: "UNSUPPORTED_TYPE" } }
    );

    expect(
      await transcribeStoredAudio(job, createWorkflowTelemetry(job.env), {
        sourceKey: AUDIO_KEY,
      })
    ).toEqual({ processed: null, text: null });
    expect(factWrites()).toEqual([]);
  });
});

describe("document text", () => {
  const pdf = inferFileFormat({
    fileName: "report.pdf",
    mimeType: "application/pdf",
  });
  if (!pdf) {
    throw new Error("pdf format missing");
  }

  test("asks the inspect op for a PDF's text layer", async () => {
    const { fakes, job } = setup(
      {},
      { inspect: { data: { facts: { pageCount: 2 }, text: "Two pages" } } }
    );
    expect(
      await extractFileTextForKey(job, "users/u/cards/c/file/a.pdf", pdf, {})
    ).toEqual({ pageCount: 2, text: "Two pages" });
    expect(fakes.calls[0]?.params).toMatchObject({
      formatId: "pdf",
      mode: "pdf",
      sourceKey: "users/u/cards/c/file/a.pdf",
    });
  });

  test("a document the op declines has no text", async () => {
    const { job } = setup({}, { inspect: { fallback: "PAYLOAD_TOO_LARGE" } });
    expect(
      await extractFileTextForKey(job, "users/u/cards/c/file/a.pdf", pdf, {})
    ).toEqual({ text: "" });
  });

  test.each(["INTERNAL", "RENDERER_UNAVAILABLE"])(
    "a %s failure is thrown so the step retries",
    async (code) => {
      const { job } = setup(
        {},
        { inspect: { throws: new Error(`files_worker_error:${code}:503:r`) } }
      );
      await expect(
        extractFileTextForKey(job, "users/u/cards/c/file/a.pdf", pdf, {})
      ).rejects.toThrow(`files_worker_error:${code}`);
    }
  );

  test("a format without text is never inspected", async () => {
    const png = inferFileFormat({ fileName: "a.png", mimeType: "image/png" });
    const { fakes, job } = setup({}, {});
    expect(
      await extractFileTextForKey(job, "k", png as NonNullable<typeof png>, {})
    ).toEqual({ text: "" });
    expect(fakes.calls).toEqual([]);
  });

  test("an archive's preview facts come from a zip inspection", async () => {
    const zip = inferFileFormat({ fileName: "site.zip" });
    const { fakes, job } = setup(
      {},
      { inspect: { data: { facts: { entryCount: 3 } } } }
    );
    expect(
      await buildFilePreviewFactsForKey(
        job,
        "users/u/cards/c/file/site.zip",
        zip as NonNullable<typeof zip>
      )
    ).toEqual({ entryCount: 3 });
    expect(fakes.calls[0]?.params).toMatchObject({ mode: "zip" });
  });
});

describe("image analysis dimensions", () => {
  test("accepts images at or above the minimum dimensions", () => {
    expect(
      hasMinimumImageAnalysisDimensions({
        height: MIN_IMAGE_ANALYSIS_DIMENSION,
        width: MIN_IMAGE_ANALYSIS_DIMENSION,
      })
    ).toBe(true);
  });

  test("rejects known tiny images", () => {
    expect(hasKnownTinyImageDimensions({ height: 1, width: 1 })).toBe(true);
    expect(hasMinimumImageAnalysisDimensions({ height: 1, width: 1 })).toBe(
      false
    );
  });

  test("does not treat missing dimensions as a known tiny image", () => {
    expect(hasKnownTinyImageDimensions()).toBe(false);
    expect(hasMinimumImageAnalysisDimensions()).toBe(false);
  });
});
