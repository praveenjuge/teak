import { join } from "node:path";
import { audioCommand, WHISPER_MAX_BYTES } from "../args";
import { toolFailure, unsupported } from "../errors";
import { run } from "../exec";
import type { JobResult, Part } from "../manifest";
import type { AudioParams, WhisperMode } from "../params";
import { PeakWindows, peaksFromWindows } from "../peaks";
import { type JobContext, readOutput } from "./context";
import { probeMedia } from "./probe";

export type WhisperPlan = "native" | "converted" | "skipped";

/** MP3 and PCM go to Workers AI as they are; anything else is converted. */
export function whisperPlan(
  mode: WhisperMode,
  audioCodec: string | null
): WhisperPlan {
  if (mode === "never") {
    return "skipped";
  }
  if (mode === "always") {
    return "converted";
  }
  const codec = audioCodec ?? "";
  return codec === "mp3" || codec.startsWith("pcm_") ? "native" : "converted";
}

export async function audioJob(
  ctx: JobContext,
  params: AudioParams
): Promise<JobResult> {
  const probe = await probeMedia(ctx);
  if (!probe.audio) {
    throw unsupported("The file has no audio stream");
  }
  const whisper = whisperPlan(params.whisper, probe.facts.audioCodec);
  const whisperPath =
    whisper === "converted" ? join(ctx.dir, "whisper.mp3") : null;

  const peakWindows = new PeakWindows();
  const result = await run(
    audioCommand(ctx.dir, ctx.input, probe.audio.index, whisperPath),
    {
      deadlineEpochMs: ctx.deadlineEpochMs,
      stdout: { kind: "stream", onChunk: (chunk) => peakWindows.push(chunk) },
    }
  );
  if (result.exitCode !== 0) {
    throw toolFailure(result, "Could not decode the audio");
  }
  const bars = peakWindows.windows;
  if (bars.length === 0) {
    throw unsupported("The audio stream has no decodable samples");
  }

  const parts: Part[] = [];
  if (whisperPath) {
    const bytes = await readOutput(whisperPath);
    if (!bytes) {
      throw unsupported("Could not convert the audio for transcription");
    }
    if (bytes.byteLength >= WHISPER_MAX_BYTES) {
      throw unsupported("The audio is too long to convert for transcription");
    }
    parts.push({ name: "whisper", type: "audio/mpeg", bytes });
  }

  const peaks: Record<string, number[]> = {};
  for (const count of params.peaks) {
    peaks[String(count)] = peaksFromWindows(bars, count);
  }
  return { facts: probe.facts, parts, extra: { peaks, whisper } };
}
