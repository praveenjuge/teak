import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import { MAX_AI_TEXT_CHARACTERS } from "./inspect";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import {
  FakeBucket,
  fakeRendererPool,
  JPEG_BYTES,
  MP3_BYTES,
  mediaFacts,
  PNG_BYTES,
  type RendererCall,
  rendererError,
  rendererResponse,
} from "./testsupport";

const SECRET = "test-secret";
const SOURCE = "users/u/cards/c/file/clip.mp4";
const FRAME = "users/u/cards/c/thumbnail/frame.jpg";
const SCRUB = "users/u/cards/c/scrub/strip.jpg";
const SOURCE_BYTES = new Uint8Array(1234).fill(7);

const callOp = async (
  env: Partial<FilesOpsEnv>,
  op: string,
  params: Record<string, unknown>
) => {
  const body = JSON.stringify({ op, params, version: FILES_PROTOCOL_VERSION });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const bodySha256 = await sha256Hex(body);
  const response = await handleInternalOp(
    new Request("https://files.teakvault.com/__ops/v1", {
      body,
      headers: {
        "x-teak-expires-at": expiresAt,
        "x-teak-request-id": requestId,
        "x-teak-signature": await hmacSha256Hex(
          SECRET,
          buildFilesOpSigningPayload({ bodySha256, expiresAt, requestId })
        ),
      },
      method: "POST",
    }),
    { FILES_SIGNING_SECRET: SECRET, ...env } as FilesOpsEnv
  );
  return {
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; message: string; retryable: boolean };
    },
    status: response.status,
  };
};

const setup = async (
  answer: (call: RendererCall) => Response | Promise<Response>,
  key = SOURCE
) => {
  const bucket = new FakeBucket();
  await bucket.put(key, SOURCE_BYTES, {
    httpMetadata: { contentType: "video/mp4" },
  });
  const pool = fakeRendererPool(answer);
  return {
    bucket,
    calls: pool.calls,
    env: { BUCKET: bucket as never, MEDIA_RENDERER: pool.namespace },
  };
};

const videoAnswer = (scrub: boolean) => () =>
  rendererResponse(
    {
      facts: mediaFacts({ format: "webm", videoCodec: "vp9" }),
      frame: { height: 36, timeSeconds: 1, width: 64 },
      scrub: scrub ? { frameHeight: 18, frameWidth: 32, frames: 10 } : null,
    },
    [
      { bytes: JPEG_BYTES, name: "frame", type: "image/jpeg" },
      ...(scrub
        ? [{ bytes: JPEG_BYTES, name: "scrub", type: "image/jpeg" }]
        : []),
    ]
  );

describe("extract-video-frame", () => {
  test("stores the frame and the scrub sprite, and returns the media facts", async () => {
    const { bucket, calls, env } = await setup(videoAnswer(true));
    const { body, status } = await callOp(env, "extract-video-frame", {
      destinationKey: FRAME,
      scrubDestinationKey: SCRUB,
      sourceKey: SOURCE,
    });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      durationSeconds: 2.5,
      facts: { container: "webm", videoCodec: "vp9" },
      originalHeight: 36,
      originalWidth: 64,
      scrub: { frameHeight: 18, frameWidth: 32, frames: 10 },
      storedContentType: "image/jpeg",
    });
    expect(calls).toEqual([
      {
        bytes: SOURCE_BYTES.length,
        instance: expect.stringMatching(/^renderer-\d$/),
        path: "/video?frameMax=1600&scrubFrames=10&scrubMax=360",
      },
    ]);
    expect(bucket.objects.get(FRAME)?.bytes).toEqual(JPEG_BYTES);
    expect(bucket.objects.get(SCRUB)?.httpMetadata).toEqual({
      contentType: "image/jpeg",
    });
  });

  test("asks for no sprite when Convex passes no scrub key", async () => {
    const { calls, env } = await setup(videoAnswer(false));
    const { body } = await callOp(env, "extract-video-frame", {
      destinationKey: FRAME,
      sourceKey: SOURCE,
    });
    expect(calls[0]?.path).toContain("scrubFrames=0");
    expect(body.data).not.toHaveProperty("scrub");
  });

  test("keeps the frame when the sprite could not be made", async () => {
    const { bucket, env } = await setup(videoAnswer(false));
    const { body } = await callOp(env, "extract-video-frame", {
      destinationKey: FRAME,
      scrubDestinationKey: SCRUB,
      sourceKey: SOURCE,
    });
    expect(body.data?.scrub).toBeNull();
    expect(bucket.objects.has(FRAME)).toBe(true);
    expect(bucket.objects.has(SCRUB)).toBe(false);
  });

  test.each([
    ["another user's namespace", "users/other/cards/c/scrub/s.jpg"],
    ["the frame key", FRAME],
    ["a non-string", 42],
  ])("refuses a scrub key in %s", async (_name, scrubDestinationKey) => {
    const { calls, env } = await setup(videoAnswer(true));
    const { body, status } = await callOp(env, "extract-video-frame", {
      destinationKey: FRAME,
      scrubDestinationKey,
      sourceKey: SOURCE,
    });
    expect(status).toBe(400);
    expect(body.error?.message).toBe("invalid_storage_key");
    expect(calls).toEqual([]);
  });

  test("moves on from a busy instance to the next one", async () => {
    let first = true;
    const { calls, env } = await setup((call) => {
      if (first) {
        first = false;
        return rendererError(503, "busy");
      }
      return videoAnswer(false)(call);
    });
    const { status } = await callOp(env, "extract-video-frame", {
      destinationKey: FRAME,
      sourceKey: SOURCE,
    });
    expect(status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.instance).not.toBe(calls[1]?.instance);
    // Each attempt streams the whole source again.
    expect(calls[1]?.bytes).toBe(SOURCE_BYTES.length);
  });

  test("answers a retryable RENDERER_UNAVAILABLE when every instance is busy", async () => {
    const { bucket, calls, env } = await setup(() =>
      rendererError(503, "busy")
    );
    const { body, status } = await callOp(
      { ...env, MEDIA_RENDERER_INSTANCES: "3" },
      "extract-video-frame",
      { destinationKey: FRAME, sourceKey: SOURCE }
    );
    expect(status).toBe(503);
    expect(body.error).toMatchObject({
      code: "RENDERER_UNAVAILABLE",
      retryable: true,
    });
    expect(calls).toHaveLength(3);
    expect(bucket.objects.has(FRAME)).toBe(false);
  });

  test.each([
    [415, "unsupported", 415, "UNSUPPORTED"],
    [422, "timeout", 415, "UNSUPPORTED"],
    [413, "too_large", 413, "PAYLOAD_TOO_LARGE"],
    [500, "internal", 503, "RENDERER_UNAVAILABLE"],
  ])(
    "maps a Container %i to %s",
    async (containerStatus, error, status, code) => {
      const { bucket, env } = await setup(() =>
        rendererError(containerStatus, error)
      );
      const result = await callOp(env, "extract-video-frame", {
        destinationKey: FRAME,
        sourceKey: SOURCE,
      });
      expect(result.status).toBe(status);
      expect(result.body.error?.code).toBe(code);
      expect(bucket.objects.has(FRAME)).toBe(false);
    }
  );

  test("refuses a frame that is not a JPEG", async () => {
    const { bucket, env } = await setup(() =>
      rendererResponse({ facts: mediaFacts() }, [
        { bytes: PNG_BYTES, name: "frame", type: "image/jpeg" },
      ])
    );
    const { status } = await callOp(env, "extract-video-frame", {
      destinationKey: FRAME,
      sourceKey: SOURCE,
    });
    expect(status).toBe(503);
    expect(bucket.objects.has(FRAME)).toBe(false);
  });

  test("answers RENDERER_UNAVAILABLE when the binding is missing", async () => {
    const bucket = new FakeBucket();
    await bucket.put(SOURCE, SOURCE_BYTES);
    const { body, status } = await callOp(
      { BUCKET: bucket as never },
      "extract-video-frame",
      { destinationKey: FRAME, sourceKey: SOURCE }
    );
    expect(status).toBe(503);
    expect(body.error?.message).toBe("renderer_unavailable:binding_missing");
  });
});

describe("render-pdf-thumbnail and probe-media", () => {
  test("stores page 1 as a PNG with its size", async () => {
    const pdf = "users/u/cards/c/file/a.pdf";
    const { bucket, calls, env } = await setup(
      () =>
        rendererResponse({ page: { height: 1600, width: 1237 }, pages: 60 }, [
          { bytes: PNG_BYTES, name: "page", type: "image/png" },
        ]),
      pdf
    );
    const { body, status } = await callOp(env, "render-pdf-thumbnail", {
      destinationKey: FRAME,
      sourceKey: pdf,
    });
    expect(status).toBe(200);
    expect(body.data).toEqual({
      height: 1600,
      storedBytes: PNG_BYTES.length,
      storedContentType: "image/png",
      width: 1237,
    });
    expect(calls[0]?.path).toBe("/pdf/page?max=1600");
    expect(bucket.objects.get(FRAME)?.httpMetadata).toEqual({
      contentType: "image/png",
    });
  });

  test("probe-media reports the Container's facts", async () => {
    const { env } = await setup(() =>
      rendererResponse({
        facts: mediaFacts({ format: "matroska", height: 1080, width: 1920 }),
      })
    );
    const { body, status } = await callOp(env, "probe-media", {
      sourceKey: SOURCE,
    });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      container: "matroska",
      durationSeconds: 2.5,
      hasVideo: true,
      height: 1080,
      width: 1920,
    });
  });
});

describe("inspect pdf", () => {
  const pdf = "users/u/cards/c/file/a.pdf";
  const text = (value: string) => new TextEncoder().encode(value);

  test("returns the renderer's text and page count", async () => {
    const { calls, env } = await setup(
      () =>
        rendererResponse({ pages: 60, truncated: true }, [
          {
            bytes: text("  Page one\n\fPage two  "),
            name: "text",
            type: "text/plain",
          },
        ]),
      pdf
    );
    const { body, status } = await callOp(env, "inspect", {
      maxBytes: 100 * 1024 * 1024,
      mode: "pdf",
      sourceKey: pdf,
    });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      facts: { pageCount: 60, wordCount: 4 },
      text: "Page one\n\nPage two",
    });
    expect(calls[0]?.path).toBe(
      `/pdf/text?maxPages=50&maxChars=${MAX_AI_TEXT_CHARACTERS}`
    );
  });

  test("returns empty text for a PDF the renderer cannot read", async () => {
    const { body, status } = await (async () => {
      const { env } = await setup(() => rendererError(415, "unsupported"), pdf);
      return await callOp(env, "inspect", {
        maxBytes: 1024 * 1024,
        mode: "pdf",
        sourceKey: pdf,
      });
    })();
    expect(status).toBe(200);
    expect(body.data?.text).toBe("");
  });

  test("skips a PDF over maxBytes without rendering it", async () => {
    const { calls, env } = await setup(() => rendererError(500, "x"), pdf);
    const { body } = await callOp(env, "inspect", {
      maxBytes: 10,
      mode: "pdf",
      sourceKey: pdf,
    });
    expect(body.data?.text).toBe("");
    expect(calls).toEqual([]);
  });

  test("retries later when the renderer is unavailable", async () => {
    const { env } = await setup(() => rendererError(503, "unavailable"), pdf);
    const { body, status } = await callOp(env, "inspect", {
      maxBytes: 1024 * 1024,
      mode: "pdf",
      sourceKey: pdf,
    });
    expect(status).toBe(503);
    expect(body.error?.code).toBe("RENDERER_UNAVAILABLE");
  });

  test("allows 100 MiB only for PDFs", async () => {
    const { env } = await setup(() => rendererError(500, "x"), pdf);
    const { status } = await callOp(env, "inspect", {
      maxBytes: 100 * 1024 * 1024,
      mode: "text",
      sourceKey: pdf,
    });
    expect(status).toBe(400);
  });
});

describe("process-audio", () => {
  const audio = "users/u/cards/c/file/memo.ogg";
  const grid = Array.from({ length: 45 }, (_, index) => index);
  const detail = Array.from({ length: 200 }, (_, index) => index % 101);

  const audioAnswer =
    (
      whisper: "converted" | "native" | "skipped",
      peaks = { "45": grid, "200": detail }
    ) =>
    (call: RendererCall) => {
      const always = call.path.includes("whisper=always");
      const converted = always || whisper === "converted";
      return rendererResponse(
        {
          facts: mediaFacts({
            audioCodec: "opus",
            durationSeconds: 12.5,
            format: "ogg",
            hasAudio: true,
            hasVideo: false,
            height: null,
            videoCodec: null,
            width: null,
          }),
          peaks,
          whisper: always ? "converted" : whisper,
        },
        converted
          ? [{ bytes: MP3_BYTES, name: "whisper", type: "audio/mpeg" }]
          : []
      );
    };

  const fakeAi = (answers: Array<Error | string>) => {
    const runs: Array<{ bytes: number; contentType: string }> = [];
    return {
      ai: {
        run: async (_model: string, args: Record<string, unknown>) => {
          const input = args.audio as {
            body: ReadableStream;
            contentType: string;
          };
          runs.push({
            bytes: (await new Response(input.body).arrayBuffer()).byteLength,
            contentType: input.contentType,
          });
          const answer = answers.shift();
          if (answer instanceof Error) {
            throw answer;
          }
          return { text: answer };
        },
      },
      runs,
    };
  };

  test("returns facts, both waveforms and a transcript of the converted audio", async () => {
    const { calls, env } = await setup(audioAnswer("converted"), audio);
    const { ai, runs } = fakeAi(["hello there"]);
    const { body, status } = await callOp({ ...env, AI: ai }, "process-audio", {
      mimeType: "audio/ogg",
      sourceKey: audio,
      transcribe: true,
    });
    expect(status).toBe(200);
    expect(body.data).toEqual({
      facts: expect.objectContaining({
        container: "ogg",
        durationSeconds: 12.5,
      }),
      peaks: { detail, grid },
      transcript: { status: "completed", text: "hello there" },
    });
    expect(calls[0]?.path).toBe("/audio?peaks=45,200&whisper=auto");
    expect(runs).toEqual([
      { bytes: MP3_BYTES.length, contentType: "audio/mpeg" },
    ]);
  });

  test("sends native audio straight from R2", async () => {
    const { env } = await setup(audioAnswer("native"), audio);
    const { ai, runs } = fakeAi(["native words"]);
    const { body } = await callOp({ ...env, AI: ai }, "process-audio", {
      mimeType: "audio/wav",
      sourceKey: audio,
      transcribe: true,
    });
    expect(body.data?.transcript).toEqual({
      status: "completed",
      text: "native words",
    });
    expect(runs).toEqual([
      { bytes: SOURCE_BYTES.length, contentType: "audio/wav" },
    ]);
  });

  test("labels native audio with its stored type when no hint is given", async () => {
    const { bucket, env } = await setup(audioAnswer("native"), audio);
    await bucket.put(audio, SOURCE_BYTES, {
      httpMetadata: { contentType: "audio/wav" },
    });
    const { ai, runs } = fakeAi(["words"]);
    await callOp({ ...env, AI: ai }, "process-audio", {
      sourceKey: audio,
      transcribe: true,
    });
    expect(runs).toEqual([
      { bytes: SOURCE_BYTES.length, contentType: "audio/wav" },
    ]);
  });

  test("converts and retries once when Whisper cannot decode the original", async () => {
    const { calls, env } = await setup(audioAnswer("native"), audio);
    const { ai, runs } = fakeAi([
      new Error("3030: Failed to decode audio file."),
      "after conversion",
    ]);
    const { body } = await callOp({ ...env, AI: ai }, "process-audio", {
      sourceKey: audio,
      transcribe: true,
    });
    expect(body.data?.transcript).toEqual({
      status: "completed",
      text: "after conversion",
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/audio?peaks=45,200&whisper=auto",
      "/audio?peaks=45&whisper=always",
    ]);
    expect(runs[1]).toEqual({
      bytes: MP3_BYTES.length,
      contentType: "audio/mpeg",
    });
  });

  test("keeps the waveform when the converted audio still cannot be decoded", async () => {
    const { env } = await setup(audioAnswer("converted"), audio);
    const { ai } = fakeAi([new Error("3030: Failed to decode audio file.")]);
    const { body, status } = await callOp({ ...env, AI: ai }, "process-audio", {
      sourceKey: audio,
      transcribe: true,
    });
    expect(status).toBe(200);
    expect(body.data?.peaks).toBeDefined();
    expect(body.data?.transcript).toEqual({
      reason: "audio_decode_failed",
      status: "failed",
    });
  });

  test("skips Whisper when no transcript is wanted", async () => {
    const { calls, env } = await setup(audioAnswer("skipped"), audio);
    const { ai, runs } = fakeAi([]);
    const { body } = await callOp({ ...env, AI: ai }, "process-audio", {
      sourceKey: audio,
      transcribe: false,
    });
    expect(calls[0]?.path).toBe("/audio?peaks=45,200&whisper=never");
    expect(body.data?.transcript).toEqual({
      reason: "not_requested",
      status: "skipped",
    });
    expect(runs).toEqual([]);
  });

  test("leaves out peaks that are the wrong length or out of range", async () => {
    const { env } = await setup(
      audioAnswer("skipped", { "45": [...grid.slice(1), 101], "200": detail }),
      audio
    );
    const { body } = await callOp(env, "process-audio", {
      sourceKey: audio,
      transcribe: false,
    });
    expect(body.data).not.toHaveProperty("peaks");
  });

  test("rejects a request without the transcribe flag", async () => {
    const { calls, env } = await setup(audioAnswer("skipped"), audio);
    const { status } = await callOp(env, "process-audio", {
      sourceKey: audio,
    });
    expect(status).toBe(400);
    expect(calls).toEqual([]);
  });
});
