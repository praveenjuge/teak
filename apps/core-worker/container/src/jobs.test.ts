import { describe, expect, test } from "bun:test";
import { toolFailure } from "./errors";
import { whisperPlan } from "./jobs/audio";
import {
  animationFrameRate,
  paletteFromSamples,
  sampleFrames,
} from "./jobs/palette";
import { capText, parsePageCount, pngSize } from "./jobs/pdf";
import { describeProbe, type FfprobeOutput, formatToken } from "./jobs/probe";
import {
  exceedsFrameLimits,
  fitWithin,
  frameTimeSeconds,
  scrubTimes,
} from "./jobs/video";

const NO_HEADER = new Uint8Array();
const WEBM_HEADER = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 0x77,
  0x65, 0x62, 0x6d,
]);

describe("describeProbe", () => {
  const phone: FfprobeOutput = {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "12.5",
      tags: { major_brand: "qt  " },
    },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "hevc",
        width: 1920,
        height: 1080,
        side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
      },
      { index: 1, codec_type: "audio", codec_name: "aac" },
    ],
  };

  test("swaps width and height for a quarter-turn display matrix", () => {
    expect(describeProbe(phone, NO_HEADER)).toEqual({
      facts: {
        format: "mov",
        durationSeconds: 12.5,
        width: 1080,
        height: 1920,
        videoCodec: "hevc",
        audioCodec: "aac",
        hasVideo: true,
        hasAudio: true,
      },
      video: { codedHeight: 1080, codedWidth: 1920, index: 0 },
      audio: { index: 1 },
    });
  });

  test("reads the legacy rotate tag", () => {
    const tagged: FfprobeOutput = {
      ...phone,
      streams: [
        {
          index: 0,
          codec_type: "video",
          width: 640,
          height: 480,
          tags: { rotate: "270" },
        },
      ],
    };
    expect(describeProbe(tagged, NO_HEADER).facts).toMatchObject({
      width: 480,
      height: 640,
    });
  });

  test("keeps the size for a half turn", () => {
    const flipped: FfprobeOutput = {
      ...phone,
      streams: [
        {
          index: 0,
          codec_type: "video",
          width: 640,
          height: 480,
          side_data_list: [{ side_data_type: "Display Matrix", rotation: 180 }],
        },
      ],
    };
    expect(describeProbe(flipped, NO_HEADER).facts).toMatchObject({
      width: 640,
      height: 480,
    });
  });

  test("cover art does not count as video", () => {
    const song: FfprobeOutput = {
      format: { format_name: "mp3", duration: "180.2" },
      streams: [
        { index: 0, codec_type: "audio", codec_name: "mp3" },
        {
          index: 1,
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
      ],
    };
    expect(describeProbe(song, NO_HEADER)).toEqual({
      facts: {
        format: "mp3",
        durationSeconds: 180.2,
        width: null,
        height: null,
        videoCodec: null,
        audioCodec: "mp3",
        hasVideo: false,
        hasAudio: true,
      },
      video: null,
      audio: { index: 0 },
    });
  });

  test("an unknown duration is null", () => {
    const live: FfprobeOutput = {
      format: { format_name: "matroska,webm", duration: "N/A" },
      streams: [{ index: 0, codec_type: "audio", codec_name: "opus" }],
    };
    expect(describeProbe(live, NO_HEADER).facts.durationSeconds).toBeNull();
  });
});

describe("formatToken", () => {
  const MOV = "mov,mp4,m4a,3gp,3g2,mj2";
  test.each([
    [MOV, "isom", "mp4"],
    [MOV, "mp42", "mp4"],
    [MOV, "qt  ", "mov"],
    [MOV, undefined, "mov"],
    [MOV, "M4A ", "m4a"],
    [MOV, "3gp4", "3gp"],
    ["mp3", undefined, "mp3"],
    ["wav", undefined, "wav"],
    ["ogg", undefined, "ogg"],
    ["avi", undefined, "avi"],
  ])("%s with brand %p is %s", (name, brand, expected) => {
    expect(formatToken(name, brand, NO_HEADER)).toBe(expected);
  });

  test("tells WebM from Matroska by the EBML doctype", () => {
    expect(formatToken("matroska,webm", undefined, WEBM_HEADER)).toBe("webm");
    expect(formatToken("matroska,webm", undefined, NO_HEADER)).toBe("matroska");
  });
});

describe("video sizing and timing", () => {
  test.each([
    [null, 0],
    [0.5, 0],
    [1.99, 0],
    [2, 1],
    [19.9, 1],
    [30, 3],
    [50, 5],
    [3600, 5],
  ])("the thumbnail for a %ps video comes from %ps", (duration, expected) => {
    expect(frameTimeSeconds(duration)).toBe(expected);
  });

  test("fits inside the box with even sides and never upscales", () => {
    expect(fitWithin(1920, 1080, 1600)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(1080, 1920, 360)).toEqual({ width: 202, height: 360 });
    expect(fitWithin(160, 96, 4096)).toEqual({ width: 160, height: 96 });
    expect(fitWithin(161, 97, 4096)).toEqual({ width: 160, height: 96 });
  });

  test("spaces scrub frames evenly across the duration", () => {
    expect(scrubTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(scrubTimes(3, 1)).toEqual([1.5]);
  });

  test("refuses frames over 40 megapixels or 8192 a side", () => {
    expect(exceedsFrameLimits(7680, 4320)).toBe(false);
    expect(exceedsFrameLimits(8192, 4096)).toBe(false);
    expect(exceedsFrameLimits(8193, 100)).toBe(true);
    expect(exceedsFrameLimits(100, 8193)).toBe(true);
    expect(exceedsFrameLimits(8000, 5001)).toBe(true);
  });
});

describe("palette samples", () => {
  const size = { width: 2, height: 1 };
  const red = [255, 0, 0, 255];
  const blue = [0, 0, 255, 255];

  test("keeps whole frames and drops a cut-off one", () => {
    const stdout = new Uint8Array([...red, ...red, ...blue, ...blue, 1, 2]);
    expect(sampleFrames(stdout, size)?.byteLength).toBe(16);
    expect(sampleFrames(new Uint8Array([...red]), size)).toBeNull();
  });

  test("reads one palette across every frame", () => {
    const frame = (color: number[]) => new Uint8Array([...color, ...color]);
    expect(
      paletteFromSamples([frame(red), frame(red), frame(red), frame(blue)])
    ).toEqual(["#FF0000", "#0000FF"]);
    expect(paletteFromSamples([])).toEqual([]);
  });

  test("spreads animation frames across the duration", () => {
    expect(animationFrameRate(2, 8)).toBe(4);
    expect(animationFrameRate(null, 8)).toBeNull();
    expect(animationFrameRate(2, 1)).toBeNull();
  });
});

describe("whisperPlan", () => {
  test.each([
    ["auto", "mp3", "native"],
    ["auto", "pcm_s16le", "native"],
    ["auto", "pcm_f32le", "native"],
    ["auto", "aac", "converted"],
    ["auto", "opus", "converted"],
    ["auto", null, "converted"],
    ["always", "mp3", "converted"],
    ["always", "pcm_s16le", "converted"],
    ["never", "aac", "skipped"],
  ] as const)("whisper=%s with %p is %s", (mode, codec, expected) => {
    expect(whisperPlan(mode, codec)).toBe(expected);
  });
});

describe("pdf helpers", () => {
  test("reads the page count from pdfinfo", () => {
    expect(
      parsePageCount("Title: x\nPages:          60\nEncrypted: no\n")
    ).toBe(60);
    expect(parsePageCount("Title: x\n")).toBeNull();
  });

  test("reads PNG dimensions and rejects anything else", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer);
    view.setUint32(16, 1237);
    view.setUint32(20, 1600);
    expect(pngSize(png)).toEqual({ width: 1237, height: 1600 });
    expect(pngSize(new Uint8Array(24))).toBeNull();
  });

  test("trims and caps text by characters without splitting one", () => {
    expect(capText("  hello  ", 10)).toEqual({ text: "hello", cut: false });
    expect(capText("hello world", 5)).toEqual({ text: "hello", cut: true });
    expect(capText("a😀b", 2)).toEqual({ text: "a😀", cut: true });
  });
});

describe("toolFailure", () => {
  test("a timed-out tool is a 422 timeout", () => {
    expect(toolFailure({ timedOut: true, stderr: "" }, "x")).toMatchObject({
      code: "timeout",
      status: 422,
    });
  });

  test("a failed tool is a 415 that names the input, not its path", () => {
    const error = toolFailure(
      {
        timedOut: false,
        stderr:
          "noise\nfile:/work/0a1b/input: Invalid data found when processing input\n",
      },
      "Could not read the media"
    );
    expect(error).toMatchObject({ code: "unsupported", status: 415 });
    expect(error.message).toBe(
      "Could not read the media: input: Invalid data found when processing input"
    );
  });
});
