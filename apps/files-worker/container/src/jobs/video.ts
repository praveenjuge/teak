import { join } from "node:path";
import {
  animationSampleCommand,
  frameCommand,
  type SampleSize,
  spriteCommand,
  tileCommand,
} from "../args";
import { toolFailure, unsupported } from "../errors";
import { run } from "../exec";
import type { JobResult } from "../manifest";
import type { AnimationParams, VideoParams } from "../params";
import { type JobContext, readOutput } from "./context";
import {
  animationFrameRate,
  paletteFromSamples,
  sampleFrames,
} from "./palette";
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

/** Long side of each frame the palette is read from. */
export const PALETTE_SAMPLE_MAX = 48;

export function paletteSampleSize(width: number, height: number): SampleSize {
  return fitWithin(width, height, PALETTE_SAMPLE_MAX);
}

async function extractFrame(
  ctx: JobContext,
  streamIndex: number,
  timeSeconds: number,
  size: { width: number; height: number },
  sample: SampleSize
): Promise<{
  bytes: Uint8Array;
  sample: Uint8Array | null;
  timeSeconds: number;
}> {
  const output = join(ctx.dir, "frame.jpg");
  const attempt = async (at: number) => {
    const result = await run(
      frameCommand({
        jobDir: ctx.dir,
        input: ctx.input,
        streamIndex,
        timeSeconds: at,
        output,
        sample,
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
  return {
    bytes,
    sample: sampleFrames(result.stdout, sample),
    timeSeconds: usedTime,
  };
}

/**
 * The scrub sprite, and a palette sample of each tile that decoded (kept even
 * when a later tile fails and the sprite is dropped).
 */
async function buildSprite(
  ctx: JobContext,
  streamIndex: number,
  times: number[],
  size: { width: number; height: number },
  sample: SampleSize
): Promise<{ samples: Uint8Array[]; sprite: Uint8Array | null }> {
  const tiles: string[] = [];
  const samples: Uint8Array[] = [];
  for (const [index, timeSeconds] of times.entries()) {
    const output = join(ctx.dir, `tile-${index}.mkv`);
    const result = await run(
      tileCommand({
        jobDir: ctx.dir,
        input: ctx.input,
        streamIndex,
        timeSeconds,
        output,
        sample,
        ...size,
      }),
      { deadline: ctx.deadline }
    );
    if (result.exitCode !== 0 || !(await readOutput(output))) {
      return { samples, sprite: null };
    }
    const pixels = sampleFrames(result.stdout, sample);
    if (pixels) {
      samples.push(pixels);
    }
    tiles.push(output);
  }
  const output = join(ctx.dir, "scrub.jpg");
  const result = await run(spriteCommand(ctx.dir, tiles, output), {
    deadline: ctx.deadline,
  });
  return {
    samples,
    sprite: result.exitCode === 0 ? await readOutput(output) : null,
  };
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
  const sampleSize = paletteSampleSize(facts.width, facts.height);
  const frame = await extractFrame(
    ctx,
    video.index,
    frameTimeSeconds(facts.durationSeconds),
    frameSize,
    sampleSize
  );
  const parts = [{ name: "frame", type: "image/jpeg", bytes: frame.bytes }];
  // The thumbnail and every scrub tile, so the palette spans the whole video.
  const samples = frame.sample ? [frame.sample] : [];

  let scrub: {
    frames: number;
    frameWidth: number;
    frameHeight: number;
  } | null = null;
  const duration = facts.durationSeconds;
  if (params.scrubFrames > 0 && duration !== null && duration >= 1) {
    const tileSize = fitWithin(facts.width, facts.height, params.scrubMax);
    const { samples: tileSamples, sprite } = await buildSprite(
      ctx,
      video.index,
      scrubTimes(duration, params.scrubFrames),
      tileSize,
      sampleSize
    );
    samples.push(...tileSamples);
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
      palette: paletteFromSamples(samples),
      scrub,
    },
  };
}

/**
 * The palette of a short animation (an animated GIF), read from evenly spaced
 * frames so colors that only appear later still count. Nothing is stored.
 */
export async function animationPaletteJob(
  ctx: JobContext,
  params: AnimationParams
): Promise<JobResult> {
  const { facts, video } = await probeMedia(ctx);
  if (!(video && facts.width && facts.height)) {
    throw unsupported("The file has no video stream");
  }
  if (exceedsFrameLimits(video.width, video.height)) {
    throw unsupported(
      `Frames of ${video.width}×${video.height} are larger than allowed`
    );
  }
  const size = paletteSampleSize(facts.width, facts.height);
  const result = await run(
    animationSampleCommand({
      jobDir: ctx.dir,
      input: ctx.input,
      streamIndex: video.index,
      frames: params.frames,
      framesPerSecond: animationFrameRate(facts.durationSeconds, params.frames),
      ...size,
    }),
    {
      deadline: ctx.deadline,
      maxStdoutBytes: params.frames * size.width * size.height * 4,
    }
  );
  const pixels =
    result.exitCode === 0 ? sampleFrames(result.stdout, size) : null;
  if (!pixels) {
    throw toolFailure(result, "Could not decode a frame");
  }
  return { facts, parts: [], extra: { palette: paletteFromSamples([pixels]) } };
}
