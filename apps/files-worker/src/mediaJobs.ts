import {
  FILES_RENDER_MAX_SOURCE_BYTES,
  FILES_SCRUB_FRAMES,
  FILES_TRANSCRIPT_MAX_BYTES,
  FILES_TRANSCRIPTION_MODEL,
  FILES_WAVEFORM_BARS,
  type FilesAnimationPaletteResult,
  type FilesAudioTranscript,
  type FilesAudioWaveform,
  type FilesMediaProbeResult,
  type FilesPdfThumbnailResult,
  type FilesProcessAudioResult,
  type FilesVideoFrameResult,
  type FilesVideoScrub,
} from "@teak/files-protocol";
import type { WorkersAiBinding } from "./aiGateway";
import {
  MAX_AI_TEXT_CHARACTERS,
  MAX_PDF_TEXT_PAGES,
  textFacts,
} from "./inspect";
import {
  callRenderer,
  RendererDeclined,
  type RendererEnv,
  type RendererManifest,
  type RendererSource,
} from "./rendererClient";
import { isAudioDecodeError } from "./transcript";
import { InspectSourceMissing } from "./zip";

export interface MediaJobsEnv extends RendererEnv {
  AI?: WorkersAiBinding;
  BUCKET: R2Bucket;
}

const MAX_RENDER_DIMENSION = 1600;
const MAX_SCRUB_FRAME_DIMENSION = 360;
const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const MAX_SCRUB_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_WHISPER_BYTES = 32 * 1024 * 1024;
const MAX_PDF_TEXT_BYTES = MAX_AI_TEXT_CHARACTERS * 4;
const MAX_SCRUB_FRAME_COUNT = 20;
const MAX_IMAGE_SIDE = 8192;

const JOB_TIMEOUT_MS = {
  animation: 30_000,
  audio: 120_000,
  pdf: 30_000,
  probe: 15_000,
  video: 60_000,
} as const;

export const r2SourceOpener = (
  bucket: R2Bucket,
  key: string
): (() => Promise<RendererSource>) => {
  let etag: string | null = null;
  return async () => {
    const object = await bucket.get(key);
    if (!object) {
      throw new InspectSourceMissing();
    }
    if (
      (etag !== null && object.httpEtag !== etag) ||
      object.size > FILES_RENDER_MAX_SOURCE_BYTES
    ) {
      await object.body.cancel();
      throw new Error(
        etag !== null && object.httpEtag !== etag
          ? "source_changed"
          : "source_too_large"
      );
    }
    etag = object.httpEtag;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType,
      size: object.size,
    };
  };
};

const positiveNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

const positiveInteger = (value: unknown, max: number): number | null =>
  Number.isSafeInteger(value) &&
  (value as number) > 0 &&
  (value as number) <= max
    ? (value as number)
    : null;

const shortString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 64
    ? value
    : null;

export const readMediaFacts = (
  facts: RendererManifest["facts"]
): FilesMediaProbeResult => {
  if (!facts) {
    throw new RendererDeclined("no_media_facts");
  }
  return {
    audioCodec: shortString(facts.audioCodec),
    container: shortString(facts.format) ?? "unknown",
    durationSeconds: positiveNumber(facts.durationSeconds),
    hasAudio: facts.hasAudio === true,
    hasVideo: facts.hasVideo === true,
    height: positiveInteger(facts.height, MAX_IMAGE_SIDE),
    videoCodec: shortString(facts.videoCodec),
    width: positiveInteger(facts.width, MAX_IMAGE_SIDE),
  };
};

export const probeMediaObject = async (
  env: MediaJobsEnv,
  sourceKey: string
): Promise<FilesMediaProbeResult> => {
  const result = await callRenderer(env, {
    openSource: r2SourceOpener(env.BUCKET, sourceKey),
    outputs: {},
    path: "/probe",
    timeoutMs: JOB_TIMEOUT_MS.probe,
  });
  return readMediaFacts(result.manifest.facts);
};

const readScrub = (value: unknown): FilesVideoScrub | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const frames = positiveInteger(record.frames, MAX_SCRUB_FRAME_COUNT);
  const frameWidth = positiveInteger(record.frameWidth, MAX_IMAGE_SIDE);
  const frameHeight = positiveInteger(record.frameHeight, MAX_IMAGE_SIDE);
  return frames && frameWidth && frameHeight
    ? { frameHeight, frameWidth, frames }
    : null;
};

const MAX_PALETTE_COLORS = 8;
const HEX_COLOR = /^#[0-9A-F]{6}$/;

const readPalette = (value: unknown): string[] | null =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= MAX_PALETTE_COLORS &&
  value.every((hex) => typeof hex === "string" && HEX_COLOR.test(hex))
    ? (value as string[])
    : null;

export const extractVideoFrame = async (
  env: MediaJobsEnv,
  keys: {
    destinationKey: string;
    scrubDestinationKey?: string | null;
    sourceKey: string;
  }
): Promise<FilesVideoFrameResult> => {
  const scrubFrames = keys.scrubDestinationKey ? FILES_SCRUB_FRAMES : 0;
  const result = await callRenderer(env, {
    openSource: r2SourceOpener(env.BUCKET, keys.sourceKey),
    outputs: {
      frame: { kind: "jpeg", maxBytes: MAX_FRAME_BYTES, required: true },
      scrub: { kind: "jpeg", maxBytes: MAX_SCRUB_BYTES, required: false },
    },
    path: `/video?frameMax=${MAX_RENDER_DIMENSION}&scrubFrames=${scrubFrames}&scrubMax=${MAX_SCRUB_FRAME_DIMENSION}`,
    timeoutMs: JOB_TIMEOUT_MS.video,
  });
  const facts = readMediaFacts(result.manifest.facts);
  const frame = result.parts.get("frame") as Uint8Array;
  await env.BUCKET.put(keys.destinationKey, frame, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  const sprite = result.parts.get("scrub");
  const scrub = sprite ? readScrub(result.manifest.scrub) : null;
  if (keys.scrubDestinationKey && sprite && scrub) {
    await env.BUCKET.put(keys.scrubDestinationKey, sprite, {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }
  const palette = readPalette(result.manifest.palette);
  return {
    durationSeconds: facts.durationSeconds,
    facts,
    originalHeight: facts.height,
    originalWidth: facts.width,
    ...(palette ? { palette } : {}),
    ...(keys.scrubDestinationKey
      ? { scrub: sprite && scrub ? scrub : null }
      : {}),
    storedBytes: frame.length,
    storedContentType: "image/jpeg",
  };
};

const ANIMATION_PALETTE_FRAMES = 8;

export const extractAnimationPalette = async (
  env: MediaJobsEnv,
  sourceKey: string
): Promise<FilesAnimationPaletteResult> => {
  const result = await callRenderer(env, {
    openSource: r2SourceOpener(env.BUCKET, sourceKey),
    outputs: {},
    path: `/animation/palette?frames=${ANIMATION_PALETTE_FRAMES}`,
    timeoutMs: JOB_TIMEOUT_MS.animation,
  });
  return { palette: readPalette(result.manifest.palette) ?? [] };
};

export const renderPdfPage = async (
  env: MediaJobsEnv,
  keys: { destinationKey: string; sourceKey: string }
): Promise<FilesPdfThumbnailResult> => {
  const result = await callRenderer(env, {
    openSource: r2SourceOpener(env.BUCKET, keys.sourceKey),
    outputs: {
      page: { kind: "png", maxBytes: MAX_PAGE_BYTES, required: true },
    },
    path: `/pdf/page?max=${MAX_RENDER_DIMENSION}`,
    timeoutMs: JOB_TIMEOUT_MS.pdf,
  });
  const page = result.manifest.page as Record<string, unknown> | undefined;
  const width = positiveInteger(page?.width, MAX_IMAGE_SIDE);
  const height = positiveInteger(page?.height, MAX_IMAGE_SIDE);
  if (!(width && height)) {
    throw new RendererDeclined("page_size_missing");
  }
  const png = result.parts.get("page") as Uint8Array;
  await env.BUCKET.put(keys.destinationKey, png, {
    httpMetadata: { contentType: "image/png" },
  });
  return {
    height,
    storedBytes: png.length,
    storedContentType: "image/png",
    width,
  };
};

export const extractPdfTextViaRenderer = async (
  env: MediaJobsEnv,
  sourceKey: string,
  maxBytes: number
): Promise<{ facts: Record<string, number>; text: string }> => {
  const head = await env.BUCKET.head(sourceKey);
  if (!head) {
    throw new InspectSourceMissing();
  }
  if (head.size > maxBytes || head.size > FILES_RENDER_MAX_SOURCE_BYTES) {
    return { facts: textFacts(""), text: "" };
  }
  let result: Awaited<ReturnType<typeof callRenderer>>;
  try {
    result = await callRenderer(env, {
      openSource: r2SourceOpener(env.BUCKET, sourceKey),
      outputs: {
        text: { kind: "text", maxBytes: MAX_PDF_TEXT_BYTES, required: false },
      },
      path: `/pdf/text?maxPages=${MAX_PDF_TEXT_PAGES}&maxChars=${MAX_AI_TEXT_CHARACTERS}`,
      timeoutMs: JOB_TIMEOUT_MS.pdf,
    });
  } catch (error) {
    if (error instanceof RendererDeclined) {
      return { facts: textFacts(""), text: "" };
    }
    throw error;
  }
  const bytes = result.parts.get("text");
  const text = bytes
    ? new TextDecoder()
        .decode(bytes)
        // pdftotext ends each page with a form feed.
        .replaceAll("\f", "\n")
        .slice(0, MAX_AI_TEXT_CHARACTERS)
        .trim()
    : "";
  const pageCount = positiveInteger(result.manifest.pages, 1_000_000);
  return {
    facts: { ...textFacts(text), ...(pageCount ? { pageCount } : {}) },
    text,
  };
};

const readPeaks = (value: unknown, count: number): number[] | null => {
  const peaks = (value as Record<string, unknown> | null)?.[String(count)];
  return Array.isArray(peaks) &&
    peaks.length === count &&
    peaks.every((peak) => Number.isInteger(peak) && peak >= 0 && peak <= 100)
    ? (peaks as number[])
    : null;
};

export const readWaveform = (
  value: unknown
): FilesAudioWaveform | undefined => {
  const grid = readPeaks(value, FILES_WAVEFORM_BARS.grid);
  const detail = readPeaks(value, FILES_WAVEFORM_BARS.detail);
  return grid && detail ? { detail, grid } : undefined;
};

type AiBinding = NonNullable<MediaJobsEnv["AI"]>;

const runWhisper = async (
  ai: AiBinding,
  body: ReadableStream,
  contentType: string
): Promise<FilesAudioTranscript> => {
  const result = (await ai.run(FILES_TRANSCRIPTION_MODEL, {
    audio: { body, contentType },
  })) as { text?: unknown } | null;
  const text = result?.text ?? "";
  if (typeof text !== "string") {
    return { reason: "transcription_invalid_response", status: "failed" };
  }
  if (new TextEncoder().encode(text).byteLength > FILES_TRANSCRIPT_MAX_BYTES) {
    return { reason: "transcript_too_large", status: "failed" };
  }
  return { status: "completed", text };
};

const convertForWhisper = async (
  env: MediaJobsEnv,
  sourceKey: string
): Promise<Uint8Array | null> => {
  try {
    const result = await callRenderer(env, {
      openSource: r2SourceOpener(env.BUCKET, sourceKey),
      outputs: {
        whisper: { kind: "mp3", maxBytes: MAX_WHISPER_BYTES, required: true },
      },
      path: `/audio?peaks=${FILES_WAVEFORM_BARS.grid}&whisper=always`,
      timeoutMs: JOB_TIMEOUT_MS.audio,
    });
    return result.parts.get("whisper") ?? null;
  } catch (error) {
    if (error instanceof RendererDeclined) {
      return null;
    }
    throw error;
  }
};

const transcribe = async (
  env: MediaJobsEnv,
  ai: AiBinding,
  input: {
    converted: Uint8Array | undefined;
    mimeType: string | null;
    sourceKey: string;
  }
): Promise<FilesAudioTranscript> => {
  const mp3 = (bytes: Uint8Array) => new Blob([bytes]).stream();
  try {
    if (input.converted) {
      return await runWhisper(ai, mp3(input.converted), "audio/mpeg");
    }
    const source = await r2SourceOpener(env.BUCKET, input.sourceKey)();
    try {
      return await runWhisper(
        ai,
        source.body,
        input.mimeType || source.contentType || "audio/mpeg"
      );
    } catch (error) {
      if (!isAudioDecodeError(error)) {
        throw error;
      }
    }
    const converted = await convertForWhisper(env, input.sourceKey);
    if (!converted) {
      return { reason: "audio_decode_failed", status: "failed" };
    }
    return await runWhisper(ai, mp3(converted), "audio/mpeg");
  } catch (error) {
    if (isAudioDecodeError(error)) {
      return { reason: "audio_decode_failed", status: "failed" };
    }
    if (error instanceof Error && error.message.startsWith("renderer_")) {
      throw error;
    }
    console.warn("[files-worker] transcription failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { reason: "transcription_failed", status: "failed" };
  }
};

export const processAudio = async (
  env: MediaJobsEnv,
  params: { mimeType: string | null; sourceKey: string; transcribe: boolean }
): Promise<FilesProcessAudioResult> => {
  const result = await callRenderer(env, {
    openSource: r2SourceOpener(env.BUCKET, params.sourceKey),
    outputs: {
      whisper: { kind: "mp3", maxBytes: MAX_WHISPER_BYTES, required: false },
    },
    path: `/audio?peaks=${FILES_WAVEFORM_BARS.grid},${FILES_WAVEFORM_BARS.detail}&whisper=${params.transcribe ? "auto" : "never"}`,
    timeoutMs: JOB_TIMEOUT_MS.audio,
  });
  const facts = readMediaFacts(result.manifest.facts);
  const peaks = readWaveform(result.manifest.peaks);
  let transcript: FilesAudioTranscript;
  if (!params.transcribe) {
    transcript = { reason: "not_requested", status: "skipped" };
  } else if (env.AI) {
    transcript = await transcribe(env, env.AI, {
      converted: result.parts.get("whisper"),
      mimeType: params.mimeType,
      sourceKey: params.sourceKey,
    });
  } else {
    transcript = { reason: "ai_unavailable", status: "failed" };
  }
  return { facts, ...(peaks ? { peaks } : {}), transcript };
};
