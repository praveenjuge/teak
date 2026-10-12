import { describe, expect, test } from "bun:test";
import { MediaProbeUnsupported, probeMedia } from "./mediaProbe";
import { FakeBucket } from "./testsupport";

const fixture = async (name: string) =>
  new Uint8Array(
    await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).arrayBuffer()
  );

const stored = async (name: string) => {
  const bucket = new FakeBucket();
  const key = `users/u/cards/c/${name}`;
  await bucket.put(key, await fixture(name));
  return { bucket, key };
};

// Expected values come from ffprobe on the committed fixtures.
describe("probeMedia", () => {
  test("reads duration, size and codec from a faststart MP4", async () => {
    const { bucket, key } = await stored("fixture.mp4");
    expect(await probeMedia(bucket as never, key)).toEqual({
      container: "mp4",
      durationSeconds: 2.5,
      hasAudio: true,
      hasVideo: true,
      height: 36,
      videoCodec: "avc1",
      width: 64,
    });
  });

  test("finds a trailing moov box and reports the display size of a rotated MOV", async () => {
    const { bucket, key } = await stored("fixture-rotated.mov");
    expect(await probeMedia(bucket as never, key)).toEqual({
      container: "mov",
      durationSeconds: 3,
      hasAudio: false,
      hasVideo: true,
      height: 64,
      videoCodec: "avc1",
      width: 36,
    });
  });

  test("reads WebM duration, display size and codec", async () => {
    const { bucket, key } = await stored("fixture.webm");
    const result = await probeMedia(bucket as never, key);
    expect(result).toMatchObject({
      container: "webm",
      hasAudio: true,
      hasVideo: true,
      height: 32,
      videoCodec: "V_VP9",
      width: 48,
    });
    expect(result.durationSeconds).toBeCloseTo(1.508, 3);
  });

  test("reports an audio-only M4A without video facts", async () => {
    const { bucket, key } = await stored("fixture.m4a");
    const result = await probeMedia(bucket as never, key);
    expect(result).toMatchObject({
      hasAudio: true,
      hasVideo: false,
      height: null,
      videoCodec: null,
      width: null,
    });
    expect(result.durationSeconds).toBeCloseTo(1, 1);
  });

  test("refuses files that are not ISO BMFF or Matroska", async () => {
    const { bucket, key } = await stored("fixture.png");
    await expect(probeMedia(bucket as never, key)).rejects.toBeInstanceOf(
      MediaProbeUnsupported
    );
  });

  test("refuses a truncated MP4 whose moov box never arrives", async () => {
    const bucket = new FakeBucket();
    const bytes = await fixture("fixture-rotated.mov");
    const key = "users/u/cards/c/truncated.mov";
    await bucket.put(key, bytes.slice(0, 6000));
    await expect(probeMedia(bucket as never, key)).rejects.toBeInstanceOf(
      MediaProbeUnsupported
    );
  });

  test("caps a crafted WebM's oversized CodecID instead of failing", async () => {
    // EBML element: id bytes, then an 8-byte size (0x01 marker + 7 bytes).
    const element = (id: number[], body: Uint8Array) => {
      const size = new Uint8Array(8);
      size[0] = 0x01;
      new DataView(size.buffer).setUint32(4, body.length);
      return new Uint8Array([...id, ...size, ...body]);
    };
    const codecId = new Uint8Array(300_000).fill(0x56);
    const trackEntry = element(
      [0xae],
      new Uint8Array([
        ...element([0x83], new Uint8Array([1])),
        ...element([0x86], codecId),
      ])
    );
    const webm = new Uint8Array([
      ...element([0x1a, 0x45, 0xdf, 0xa3], new Uint8Array(0)),
      ...element(
        [0x18, 0x53, 0x80, 0x67],
        element([0x16, 0x54, 0xae, 0x6b], trackEntry)
      ),
    ]);
    const bucket = new FakeBucket();
    await bucket.put("users/u/cards/c/crafted.webm", webm);

    const result = await probeMedia(
      bucket as never,
      "users/u/cards/c/crafted.webm"
    );

    expect(result.hasVideo).toBe(true);
    expect(result.videoCodec).toBe("V".repeat(64));
  });
});
