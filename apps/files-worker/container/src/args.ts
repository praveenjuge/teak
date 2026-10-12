// Pure command-line builders. Every ffmpeg and ffprobe call goes through
// these so the hardening flags can't be forgotten: local files and pipes
// only, real container demuxers only (no playlists, concat lists, image
// sequences, lavfi or tee), one thread, and a per-allocation cap. Inputs
// and outputs must sit inside the job directory.

import { isAbsolute, relative, resolve } from "node:path";

export const FORMAT_WHITELIST = [
  "mov",
  "mp4",
  "m4a",
  "3gp",
  "3g2",
  "mj2",
  "matroska",
  "webm",
  "avi",
  "asf",
  "mpeg",
  "mpegts",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "aac",
].join(",");

export const MAX_ALLOC_BYTES = 268_435_456;
export const WHISPER_MAX_BYTES = 32 * 1024 * 1024;

// ffprobe has no -nostdin; every process gets /dev/null as stdin anyway.
const QUIET_FLAGS = ["-hide_banner", "-loglevel", "error"];
const INPUT_FLAGS = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  FORMAT_WHITELIST,
  "-threads",
  "1",
];

/** Resolves `path` and refuses anything outside `jobDir`. */
export function jobPath(jobDir: string, path: string): string {
  const resolved = resolve(path);
  const rel = relative(resolve(jobDir), resolved);
  if (!isAbsolute(path) || rel === "" || rel.startsWith("..")) {
    throw new Error(`Path ${path} is outside the job directory`);
  }
  return resolved;
}

export interface FfmpegInput {
  /** Input options placed before `-i` (seeking, decoder flags). */
  options?: string[];
  path: string;
}

export interface FfmpegOutput {
  options: string[];
  /** An absolute path inside the job directory, or "pipe:1". */
  target: string;
}

export function ffprobeCommand(jobDir: string, input: string): string[] {
  return [
    "ffprobe",
    ...QUIET_FLAGS,
    "-max_alloc",
    String(MAX_ALLOC_BYTES),
    ...INPUT_FLAGS,
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    `file:${jobPath(jobDir, input)}`,
  ];
}

export function ffmpegCommand(
  jobDir: string,
  inputs: FfmpegInput[],
  outputs: FfmpegOutput[],
  globalOptions: string[] = []
): string[] {
  const argv = [
    "ffmpeg",
    "-nostdin",
    ...QUIET_FLAGS,
    "-y",
    "-max_alloc",
    String(MAX_ALLOC_BYTES),
    "-filter_threads",
    "1",
    "-filter_complex_threads",
    "1",
    ...globalOptions,
  ];
  for (const input of inputs) {
    argv.push(
      ...(input.options ?? []),
      ...INPUT_FLAGS,
      "-i",
      `file:${jobPath(jobDir, input.path)}`
    );
  }
  for (const output of outputs) {
    const target =
      output.target === "pipe:1"
        ? "pipe:1"
        : `file:${jobPath(jobDir, output.target)}`;
    argv.push(
      ...output.options,
      "-threads",
      "1",
      "-map_metadata",
      "-1",
      target
    );
  }
  return argv;
}

export interface FrameJob {
  height: number;
  input: string;
  jobDir: string;
  output: string;
  streamIndex: number;
  timeSeconds: number;
  width: number;
}

const JPEG_OPTIONS = ["-pix_fmt", "yuvj420p", "-q:v", "3", "-f", "mjpeg"];

function scaleFilter(width: number, height: number): string {
  return `scale=${width}:${height},setsar=1`;
}

/** One accurately seeked frame, autorotated and scaled, as a JPEG. */
export function frameCommand(job: FrameJob): string[] {
  return ffmpegCommand(
    job.jobDir,
    [{ path: job.input, options: ["-ss", String(job.timeSeconds)] }],
    [
      {
        target: job.output,
        options: [
          "-map",
          `0:${job.streamIndex}`,
          "-frames:v",
          "1",
          "-vf",
          scaleFilter(job.width, job.height),
          ...JPEG_OPTIONS,
        ],
      },
    ]
  );
}

/** The keyframe at or before `timeSeconds`, found with a fast input seek. */
export function tileCommand(job: FrameJob): string[] {
  return ffmpegCommand(
    job.jobDir,
    [
      {
        path: job.input,
        options: [
          "-skip_frame",
          "nokey",
          "-ss",
          String(job.timeSeconds),
          "-noaccurate_seek",
        ],
      },
    ],
    [
      {
        target: job.output,
        options: [
          "-map",
          `0:${job.streamIndex}`,
          "-frames:v",
          "1",
          // The keyframe sits before the seek point; passthrough keeps
          // ffmpeg from dropping it for its "early" timestamp.
          "-fps_mode",
          "passthrough",
          "-vf",
          `${scaleFilter(job.width, job.height)},setpts=0`,
          "-c:v",
          "ffv1",
          "-f",
          "matroska",
        ],
      },
    ]
  );
}

/** Joins same-sized tiles left to right into one JPEG. */
export function spriteCommand(
  jobDir: string,
  tiles: string[],
  output: string
): string[] {
  const filter =
    tiles.length === 1
      ? "[0:v]null[out]"
      : `${tiles.map((_, index) => `[${index}:v]`).join("")}hstack=inputs=${tiles.length}[out]`;
  return ffmpegCommand(
    jobDir,
    tiles.map((path) => ({ path })),
    [
      {
        target: output,
        options: ["-map", "[out]", "-frames:v", "1", ...JPEG_OPTIONS],
      },
    ],
    ["-filter_complex", filter]
  );
}

/**
 * One decode, two outputs: 8 kHz mono s16le PCM on stdout for the peaks,
 * and optionally a 16 kHz mono 32 kbps MP3 for transcription.
 */
export function audioCommand(
  jobDir: string,
  input: string,
  streamIndex: number,
  whisperOutput: string | null
): string[] {
  const map = ["-map", `0:${streamIndex}`, "-ac", "1"];
  const outputs: FfmpegOutput[] = [
    {
      target: "pipe:1",
      options: [...map, "-ar", "8000", "-c:a", "pcm_s16le", "-f", "s16le"],
    },
  ];
  if (whisperOutput) {
    outputs.push({
      target: whisperOutput,
      options: [
        ...map,
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "32k",
        "-id3v2_version",
        "0",
        "-fs",
        String(WHISPER_MAX_BYTES),
        "-f",
        "mp3",
      ],
    });
  }
  return ffmpegCommand(jobDir, [{ path: input }], outputs);
}

export function pdfInfoCommand(jobDir: string, input: string): string[] {
  return ["pdfinfo", jobPath(jobDir, input)];
}

/** Renders page 1 as PNG with its long side at `max` pixels. */
export function pdfPageCommand(
  jobDir: string,
  input: string,
  max: number,
  outputPrefix: string
): string[] {
  return [
    "pdftoppm",
    "-f",
    "1",
    "-l",
    "1",
    "-singlefile",
    "-png",
    "-scale-to",
    String(max),
    jobPath(jobDir, input),
    jobPath(jobDir, outputPrefix),
  ];
}

export function pdfTextCommand(
  jobDir: string,
  input: string,
  maxPages: number
): string[] {
  return [
    "pdftotext",
    "-f",
    "1",
    "-l",
    String(maxPages),
    "-enc",
    "UTF-8",
    "-q",
    jobPath(jobDir, input),
    "-",
  ];
}
