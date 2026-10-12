import { join } from "node:path";
import { frameCommand, spriteCommand, tileCommand } from "../args";
import { toolFailure, unsupported } from "../errors";
import { run } from "../exec";
import type { JobResult } from "../manifest";
import type { VideoParams } from "../params";
import { type JobContext, readOutput } from "./context";
import { probeMedia } from "./probe";

export const MAX_PIXELS = 40_000_000;
export const MAX_SIDE = 8192;

/** Where the thumbnail comes from: a little way in, past fade-ins. */
export function frameTimeSeconds(durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds < 2) {
    return 0;
  }
  return Math.min(5, Math.max(1, Math.floor(durationSeconds * 0.1)));
}

/** Fits inside max×max without upscaling, with even sides. */
export function fitWithin(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  const even = (side: number) =>
    Math.max(2, Math.floor((side * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** `count` times evenly spaced across the duration, centred in each slot. */
export function scrubTimes(durationSeconds: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    Number((((index + 0.5) * durationSeconds) / count).toFixed(3))
  );
}

export function exceedsFrameLimits(width: number, height: number): boolean {
  return width * height > MAX_PIXELS || width > MAX_SIDE || height > MAX_SIDE;
}

async function extractFrame(
  ctx: JobContext,
  streamIndex: number,
  timeSeconds: number,
  size: { width: number; height: number }
): Promise<{ bytes: Uint8Array; timeSeconds: number }> {
  const output = join(ctx.dir, "frame.jpg");
  const attempt = async (at: number) => {
    const result = await run(
      frameCommand({
        jobDir: ctx.dir,
        input: ctx.input,
        streamIndex,
        timeSeconds: at,
        output,
        ...size,
      }),
      { deadline: ctx.deadline }
    );
    const bytes = result.exitCode === 0 ? await readOutput(output) : null;
    return { result, bytes };
  };

  let { result, bytes } = await attempt(timeSeconds);
  let usedTime = timeSeconds;
  // A seek past the last decodable frame yields nothing; the start always works.
  if (!(bytes || result.timedOut) && timeSeconds > 0) {
    ({ result, bytes } = await attempt(0));
    usedTime = 0;
  }
  if (!bytes) {
    throw toolFailure(result, "Could not decode a video frame");
  }
  return { bytes, timeSeconds: usedTime };
}

async function buildSprite(
  ctx: JobContext,
  streamIndex: number,
  times: number[],
  size: { width: number; height: number }
): Promise<Uint8Array | null> {
  const tiles: string[] = [];
  for (const [index, timeSeconds] of times.entries()) {
    const output = join(ctx.dir, `tile-${index}.mkv`);
    const result = await run(
      tileCommand({
        jobDir: ctx.dir,
        input: ctx.input,
        streamIndex,
        timeSeconds,
        output,
        ...size,
      }),
      { deadline: ctx.deadline }
    );
    if (result.exitCode !== 0 || !(await readOutput(output))) {
      return null;
    }
    tiles.push(output);
  }
  const output = join(ctx.dir, "scrub.jpg");
  const result = await run(spriteCommand(ctx.dir, tiles, output), {
    deadline: ctx.deadline,
  });
  return result.exitCode === 0 ? await readOutput(output) : null;
}

export async function videoJob(
  ctx: JobContext,
  params: VideoParams
): Promise<JobResult> {
  const probe = await probeMedia(ctx);
  const { facts, video } = probe;
  if (!(video && facts.width && facts.height)) {
    throw unsupported("The file has no video stream");
  }
  if (exceedsFrameLimits(video.width, video.height)) {
    throw unsupported(
      `Video frames of ${video.width}×${video.height} are larger than allowed`
    );
  }

  const frameSize = fitWithin(facts.width, facts.height, params.frameMax);
  const frame = await extractFrame(
    ctx,
    video.index,
    frameTimeSeconds(facts.durationSeconds),
    frameSize
  );
  const parts = [{ name: "frame", type: "image/jpeg", bytes: frame.bytes }];

  let scrub: {
    frames: number;
    frameWidth: number;
    frameHeight: number;
  } | null = null;
  const duration = facts.durationSeconds;
  if (params.scrubFrames > 0 && duration !== null && duration >= 1) {
    const tileSize = fitWithin(facts.width, facts.height, params.scrubMax);
    const sprite = await buildSprite(
      ctx,
      video.index,
      scrubTimes(duration, params.scrubFrames),
      tileSize
    );
    if (sprite) {
      parts.push({ name: "scrub", type: "image/jpeg", bytes: sprite });
      scrub = {
        frames: params.scrubFrames,
        frameWidth: tileSize.width,
        frameHeight: tileSize.height,
      };
    }
  }

  return {
    facts,
    parts,
    extra: {
      frame: { ...frameSize, timeSeconds: frame.timeSeconds },
      scrub,
    },
  };
}
