import { describe, expect, test } from "bun:test";
import { jpegSize, mp3FrameInfo, RENDERER_URL, renderFixture } from "./helpers";

describe.skipIf(!RENDERER_URL)("renderer media jobs", () => {
  test("probe reports the display size of a rotated MOV", async () => {
    const result = await renderFixture("/probe", "rotated.mov");
    expect(result.status).toBe(200);
    expect(result.manifest?.facts).toEqual({
      format: "mov",
      durationSeconds: 3,
      width: 96,
      height: 160,
      videoCodec: "h264",
      audioCodec: "aac",
      hasVideo: true,
      hasAudio: true,
    });
    expect(result.manifest?.parts).toEqual([]);
  });

  test.each([
    ["h264.mp4", "mp4", "h264"],
    ["vp9.webm", "webm", "vp9"],
    ["hevc.mp4", "mp4", "hevc"],
    ["av1.mp4", "mp4", "av1"],
    ["video.mkv", "matroska", "h264"],
    ["video.avi", "avi", "mpeg4"],
  ])(
    "probe names the container and codec of %s",
    async (name, format, codec) => {
      const result = await renderFixture("/probe", name);
      expect(result.status).toBe(200);
      expect(result.manifest?.facts?.format).toBe(format);
      expect(result.manifest?.facts?.videoCodec).toBe(codec);
      expect(result.manifest?.facts?.width).toBe(160);
      expect(result.manifest?.facts?.height).toBe(96);
    }
  );

  test("video thumbnail of a rotated MOV is upright", async () => {
    const result = await renderFixture("/video?scrubFrames=0", "rotated.mov");
    expect(result.status).toBe(200);
    expect(result.manifest?.frame).toEqual({
      width: 96,
      height: 160,
      timeSeconds: 1,
    });
    expect(jpegSize(result.parts.frame)).toEqual({ width: 96, height: 160 });
    expect(result.manifest?.scrub).toBeNull();
    expect(Object.keys(result.parts)).toEqual(["frame"]);
  });

  test("video thumbnail fits frameMax without upscaling", async () => {
    const small = await renderFixture(
      "/video?frameMax=64&scrubFrames=0",
      "h264.mp4"
    );
    expect(jpegSize(small.parts.frame)).toEqual({ width: 64, height: 38 });
    const large = await renderFixture(
      "/video?frameMax=4096&scrubFrames=0",
      "h264.mp4"
    );
    expect(jpegSize(large.parts.frame)).toEqual({ width: 160, height: 96 });
  });

  test.each([
    "h264.mp4",
    "rotated.mov",
    "vp9.webm",
    "hevc.mp4",
    "av1.mp4",
    "video.mkv",
    "video.avi",
  ])(
    "%s produces a frame and a scrub sprite of exactly N tiles",
    async (name) => {
      const result = await renderFixture(
        "/video?scrubFrames=6&scrubMax=64",
        name
      );
      expect(result.status).toBe(200);
      expect(jpegSize(result.parts.frame).width).toBeGreaterThan(0);
      const scrub = result.manifest?.scrub as {
        frames: number;
        frameWidth: number;
        frameHeight: number;
      };
      expect(scrub.frames).toBe(6);
      expect(scrub.frameWidth % 2).toBe(0);
      expect(scrub.frameHeight % 2).toBe(0);
      expect(Math.max(scrub.frameWidth, scrub.frameHeight)).toBeLessThanOrEqual(
        64
      );
      expect(jpegSize(result.parts.scrub)).toEqual({
        width: 6 * scrub.frameWidth,
        height: scrub.frameHeight,
      });
    }
  );

  test("video reports the palette across the thumbnail and scrub frames", async () => {
    const result = await renderFixture("/video?scrubFrames=4", "h264.mp4");
    expect(result.status).toBe(200);
    const palette = result.manifest?.palette as string[];
    expect(palette.length).toBeGreaterThan(1);
    expect(palette.length).toBeLessThanOrEqual(5);
    for (const hex of palette) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test("an animation's palette includes colors from its later frames", async () => {
    const result = await renderFixture(
      "/animation/palette?frames=8",
      "animation.gif"
    );
    expect(result.status).toBe(200);
    expect(result.manifest?.facts?.videoCodec).toBe("gif");
    expect(result.manifest?.parts).toEqual([]);
    // The two largest colors are the red and the blue, in either order:
    // each covers half the frames.
    const palette = (result.manifest?.palette ?? []) as string[];
    const largest = palette.slice(0, 2);
    const isRed = largest.map(
      (hex) =>
        Number.parseInt(hex.slice(1, 3), 16) >
        Number.parseInt(hex.slice(5, 7), 16)
    );
    expect(isRed.sort()).toEqual([false, true]);
  });

  test("an animation read as one frame has only its first color", async () => {
    const result = await renderFixture(
      "/animation/palette?frames=1",
      "animation.gif"
    );
    expect(result.status).toBe(200);
    const palette = result.manifest?.palette as string[];
    expect(palette.length).toBeGreaterThan(0);
    for (const hex of palette) {
      expect(Number.parseInt(hex.slice(1, 3), 16)).toBeGreaterThan(
        Number.parseInt(hex.slice(5, 7), 16)
      );
    }
  });

  test("animation palette refuses an audio-only file", async () => {
    const result = await renderFixture("/animation/palette", "audio.mp3");
    expect(result.status).toBe(415);
  });

  test("video refuses an audio-only file", async () => {
    const result = await renderFixture("/video", "audio.mp3");
    expect(result.status).toBe(415);
    expect(result.error?.error).toBe("unsupported");
  });

  test.each([
    ["audio.mp3", "native"],
    ["audio.wav", "native"],
    ["audio.ogg", "converted"],
    ["audio.flac", "converted"],
    ["audio.m4a", "converted"],
  ])("audio peaks for %s, whisper %s", async (name, whisper) => {
    const result = await renderFixture("/audio?peaks=45,200", name);
    expect(result.status).toBe(200);
    const peaks = result.manifest?.peaks as Record<string, number[]>;
    expect(Object.keys(peaks).sort()).toEqual(["200", "45"]);
    expect(peaks["45"]).toHaveLength(45);
    expect(peaks["200"]).toHaveLength(200);
    for (const bar of [...peaks["45"], ...peaks["200"]]) {
      expect(Number.isInteger(bar)).toBe(true);
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(100);
    }
    // The tone swells and fades, so the loudest bar is 100 and the edges are quiet.
    expect(Math.max(...peaks["45"])).toBe(100);
    expect(peaks["45"][0]).toBeLessThan(50);
    expect(result.manifest?.whisper).toBe(whisper);
    if (whisper === "converted") {
      expect(mp3FrameInfo(result.parts.whisper)).toEqual({
        sampleRate: 16_000,
        mono: true,
      });
    } else {
      expect(result.parts.whisper).toBeUndefined();
    }
  });

  test("whisper=always converts even an MP3", async () => {
    const result = await renderFixture("/audio?whisper=always", "audio.mp3");
    expect(result.manifest?.whisper).toBe("converted");
    expect(mp3FrameInfo(result.parts.whisper)).toEqual({
      sampleRate: 16_000,
      mono: true,
    });
  });

  test("whisper=never skips the conversion", async () => {
    const result = await renderFixture(
      "/audio?whisper=never&peaks=10",
      "audio.ogg"
    );
    expect(result.manifest?.whisper).toBe("skipped");
    expect(result.manifest?.parts).toEqual([]);
    const peaks = result.manifest?.peaks as Record<string, number[]>;
    expect(peaks["10"]).toHaveLength(10);
  });

  test("audio reads the soundtrack of a video", async () => {
    const result = await renderFixture("/audio?whisper=never", "h264.mp4");
    expect(result.status).toBe(200);
    expect(result.manifest?.facts?.audioCodec).toBe("aac");
  });

  test("audio refuses a video without sound", async () => {
    const result = await renderFixture("/audio", "vp9.webm");
    expect(result.status).toBe(415);
  });
});
