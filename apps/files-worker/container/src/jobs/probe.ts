import { ffprobeCommand } from "../args";
import { toolFailure, unsupported } from "../errors";
import { run } from "../exec";
import type { JobResult, MediaFacts } from "../manifest";
import type { JobContext } from "./context";

interface FfprobeStream {
  codec_name?: string;
  codec_type?: string;
  disposition?: { attached_pic?: number };
  height?: number;
  index: number;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
  tags?: { rotate?: string };
  width?: number;
}

export interface FfprobeOutput {
  format?: {
    format_name?: string;
    duration?: string;
    tags?: { major_brand?: string };
  };
  streams?: FfprobeStream[];
}

export interface ProbeResult {
  audio: { index: number } | null;
  facts: MediaFacts;
  /** The first real video stream (cover art excluded), coded size. */
  video: { index: number; width: number; height: number } | null;
}

const WEBM_DOCTYPE = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];
const HEADER_BYTES = 64;

function hasDocType(header: Uint8Array, pattern: number[]): boolean {
  for (let start = 0; start + pattern.length <= header.length; start++) {
    if (pattern.every((byte, offset) => header[start + offset] === byte)) {
      return true;
    }
  }
  return false;
}

export function formatToken(
  formatName: string,
  majorBrand: string | undefined,
  header: Uint8Array
): string {
  const names = formatName.toLowerCase().split(",");
  if (names.includes("mov")) {
    const brand = majorBrand?.trim().toLowerCase();
    if (!brand || brand === "qt") {
      return "mov";
    }
    if (brand.startsWith("m4a") || brand.startsWith("m4b")) {
      return "m4a";
    }
    if (brand.startsWith("3g2")) {
      return "3g2";
    }
    if (brand.startsWith("3gp")) {
      return "3gp";
    }
    return "mp4";
  }
  if (names.includes("matroska")) {
    return hasDocType(header, WEBM_DOCTYPE) ? "webm" : "matroska";
  }
  return names[0] || "unknown";
}

export function rotationDegrees(stream: FfprobeStream): number {
  const matrix = stream.side_data_list?.find(
    (entry) => entry.side_data_type === "Display Matrix"
  );
  const raw = matrix?.rotation ?? Number(stream.tags?.rotate ?? 0);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return ((Math.round(raw) % 360) + 360) % 360;
}

function positive(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function describeProbe(
  output: FfprobeOutput,
  header: Uint8Array
): ProbeResult {
  const streams = output.streams ?? [];
  const video = streams.find(
    (stream) =>
      stream.codec_type === "video" && stream.disposition?.attached_pic !== 1
  );
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const codedWidth = positive(video?.width);
  const codedHeight = positive(video?.height);
  const quarterTurn = video ? rotationDegrees(video) % 180 === 90 : false;
  const duration = Number.parseFloat(output.format?.duration ?? "");

  return {
    facts: {
      format: formatToken(
        output.format?.format_name ?? "",
        output.format?.tags?.major_brand,
        header
      ),
      durationSeconds:
        Number.isFinite(duration) && duration > 0 ? duration : null,
      width: quarterTurn ? codedHeight : codedWidth,
      height: quarterTurn ? codedWidth : codedHeight,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
    },
    video:
      video && codedWidth && codedHeight
        ? { index: video.index, width: codedWidth, height: codedHeight }
        : null,
    audio: audio ? { index: audio.index } : null,
  };
}

export async function probeMedia(ctx: JobContext): Promise<ProbeResult> {
  const result = await run(ffprobeCommand(ctx.dir, ctx.input), {
    deadline: ctx.deadline,
  });
  if (result.exitCode !== 0 || result.stdoutTruncated) {
    throw toolFailure(result, "Could not read the media");
  }
  let output: FfprobeOutput;
  try {
    output = JSON.parse(new TextDecoder().decode(result.stdout));
  } catch {
    throw unsupported("Could not read the media");
  }
  const header = await Bun.file(ctx.input).slice(0, HEADER_BYTES).bytes();
  const probe = describeProbe(output, header);
  if (!(probe.facts.hasVideo || probe.facts.hasAudio)) {
    throw unsupported("The file has no audio or video");
  }
  return probe;
}

export async function probeJob(ctx: JobContext): Promise<JobResult> {
  const probe = await probeMedia(ctx);
  return { facts: probe.facts, parts: [], extra: {} };
}
