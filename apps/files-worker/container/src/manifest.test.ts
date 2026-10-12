import { describe, expect, test } from "bun:test";
import { encodeManifest, jobResponse } from "./manifest";
import { audioParams, pdfTextParams, videoParams } from "./params";

const facts = {
  format: "mp4",
  durationSeconds: 3,
  width: 160,
  height: 96,
  videoCodec: "h264",
  audioCodec: null,
  hasVideo: true,
  hasAudio: false,
};

describe("manifest", () => {
  test("lists each part's length in order and spreads the job fields", () => {
    const encoded = encodeManifest({
      facts,
      parts: [
        { name: "frame", type: "image/jpeg", bytes: new Uint8Array(5) },
        { name: "scrub", type: "image/jpeg", bytes: new Uint8Array(2) },
      ],
      extra: { scrub: null, frame: { width: 1, height: 2, timeSeconds: 0 } },
    });
    expect(JSON.parse(encoded)).toEqual({
      protocol: 1,
      facts,
      parts: [
        { name: "frame", type: "image/jpeg", length: 5 },
        { name: "scrub", type: "image/jpeg", length: 2 },
      ],
      scrub: null,
      frame: { width: 1, height: 2, timeSeconds: 0 },
    });
  });

  test("escapes anything outside ASCII so it is a valid header value", () => {
    const encoded = encodeManifest({
      facts: { ...facts, format: "mp4–ü😀" },
      parts: [],
      extra: {},
    });
    expect(encoded).toMatch(/^[ -~]*$/);
    expect(JSON.parse(encoded).facts.format).toBe("mp4–ü😀");
  });

  test("the response body is the parts concatenated, with the manifest header", async () => {
    const response = jobResponse({
      facts: null,
      parts: [
        {
          name: "a",
          type: "text/plain",
          bytes: new TextEncoder().encode("ab"),
        },
        {
          name: "b",
          type: "text/plain",
          bytes: new TextEncoder().encode("cde"),
        },
      ],
      extra: { pages: 2 },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("5");
    expect(await response.text()).toBe("abcde");
    expect(
      JSON.parse(response.headers.get("x-teak-manifest") ?? "")
    ).toMatchObject({
      facts: null,
      pages: 2,
    });
  });

  test("a job with no parts has an empty body", async () => {
    const response = jobResponse({ facts, parts: [], extra: {} });
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });
});

describe("query params", () => {
  const query = (search: string) => new URLSearchParams(search);

  test("fill in the defaults", () => {
    expect(videoParams(query(""))).toEqual({
      frameMax: 1600,
      scrubFrames: 10,
      scrubMax: 360,
    });
    expect(audioParams(query(""))).toEqual({
      peaks: [45, 200],
      whisper: "auto",
    });
    expect(pdfTextParams(query(""))).toEqual({
      maxPages: 50,
      maxChars: 524_288,
    });
  });

  test("accept values at the edges of each range", () => {
    expect(
      videoParams(query("frameMax=64&scrubFrames=0&scrubMax=720"))
    ).toEqual({
      frameMax: 64,
      scrubFrames: 0,
      scrubMax: 720,
    });
    expect(audioParams(query("peaks=1,1000,5,7&whisper=always"))).toEqual({
      peaks: [1, 1000, 5, 7],
      whisper: "always",
    });
  });

  test.each([
    ["frameMax=63", videoParams],
    ["frameMax=4097", videoParams],
    ["frameMax=1e3", videoParams],
    ["frameMax=", videoParams],
    ["scrubFrames=-1", videoParams],
    ["scrubMax=12.5", videoParams],
    ["peaks=", audioParams],
    ["peaks=45,", audioParams],
    ["peaks=45,45", audioParams],
    ["peaks=1,2,3,4,5", audioParams],
    ["whisper=AUTO", audioParams],
    ["maxPages=501", pdfTextParams],
    ["maxChars=4194305", pdfTextParams],
  ])("reject %s with bad_request", (search, parse) => {
    expect(() => parse(query(search))).toThrow(
      expect.objectContaining({ code: "bad_request", status: 400 })
    );
  });
});
