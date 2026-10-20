import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseTiffExif, readExifFacts } from "./exif";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

const readerOf = (bytes: Uint8Array) => ({
  read: (offset: number, length: number) =>
    Promise.resolve(bytes.slice(offset, offset + length)),
  size: bytes.length,
});

const FIXTURE_FACTS = {
  exposureTime: 0.004,
  fNumber: 2.8,
  focalLength: 35,
  iso: 400,
  make: "Teak Camera Co",
  model: "Fixture One",
  takenAt: Date.parse("2026-05-17T09:00:05Z"),
};

const tiffFromJpeg = (jpeg: Uint8Array): Uint8Array => {
  const marker = Buffer.from(jpeg).indexOf(Buffer.from("Exif\0\0", "latin1"));
  const length =
    (jpeg[marker - 2] as number) * 256 + (jpeg[marker - 1] as number);
  return jpeg.slice(marker + 6, marker - 2 + length);
};

const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let offset = 8;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const bytes = (...values: number[]) => new Uint8Array(values);
const u16 = (value: number) => {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
};
const u32 = (value: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
};

const heifWithExif = (tiff: Uint8Array): Uint8Array => {
  const ftyp = box(
    "ftyp",
    new TextEncoder().encode("heic"),
    u32(0),
    new TextEncoder().encode("mif1heic")
  );
  const exifItem = new Uint8Array([...u32(0), ...tiff]);
  const infe = (id: number, type: string) =>
    box(
      "infe",
      bytes(2, 0, 0, 0),
      u16(id),
      u16(0),
      new TextEncoder().encode(type),
      bytes(0)
    );
  const iinf = box(
    "iinf",
    bytes(0, 0, 0, 0),
    u16(2),
    infe(1, "hvc1"),
    infe(2, "Exif")
  );
  const ilocFor = (exifOffset: number) =>
    box(
      "iloc",
      bytes(0, 0, 0, 0),
      bytes(0x44, 0x00), // 4-byte offsets and lengths, no base offset
      u16(2),
      u16(1),
      u16(0),
      u16(1),
      u32(0),
      u32(0),
      u16(2),
      u16(0),
      u16(1),
      u32(exifOffset),
      u32(exifItem.length)
    );
  const metaFor = (exifOffset: number) =>
    box(
      "meta",
      bytes(0, 0, 0, 0),
      box(
        "hdlr",
        bytes(0, 0, 0, 0),
        u32(0),
        new TextEncoder().encode("pict"),
        new Uint8Array(13)
      ),
      iinf,
      ilocFor(exifOffset)
    );
  const metaLength = metaFor(0).length;
  const exifOffset = ftyp.length + metaLength + 8;
  return new Uint8Array([
    ...ftyp,
    ...metaFor(exifOffset),
    ...box("mdat", exifItem),
  ]);
};

describe("readExifFacts", () => {
  test("reads camera, exposure and capture time from a JPEG but never its GPS location", async () => {
    const jpeg = fixture("fixture-exif.jpg");
    const { read, size } = readerOf(jpeg);
    const facts = await readExifFacts(read, size);
    expect(facts).toEqual(FIXTURE_FACTS);
  });

  test("finds the Exif item of a HEIF through iinf and iloc", async () => {
    const heif = heifWithExif(tiffFromJpeg(fixture("fixture-exif.jpg")));
    const { read, size } = readerOf(heif);
    const facts = await readExifFacts(read, size);
    expect(facts?.make).toBe("Teak Camera Co");
    expect(facts?.takenAt).toBe(FIXTURE_FACTS.takenAt);
    expect(facts).not.toHaveProperty("latitude");
  });

  test("returns null for images without EXIF", async () => {
    for (const name of ["fixture.png", "fixture.heic"]) {
      const { read, size } = readerOf(fixture(name));
      expect(await readExifFacts(read, size)).toBeNull();
    }
  });

  test("ignores corrupt IFD offsets instead of throwing", () => {
    const tiff = tiffFromJpeg(fixture("fixture-exif.jpg"));
    const corrupt = tiff.slice();
    new DataView(corrupt.buffer).setUint32(4, 0xff_ff_ff_00, tiff[0] === 0x49);
    expect(parseTiffExif(corrupt)).toBeNull();
    expect(parseTiffExif(tiff.slice(0, 20))).toBeNull();
  });

  test("reads a capture time without an offset as UTC", () => {
    const tiff = tiffFromJpeg(fixture("fixture-exif.jpg"));
    const text = Buffer.from(tiff)
      .toString("latin1")
      .replace("+05:30", "xx:xx");
    expect(
      parseTiffExif(new Uint8Array(Buffer.from(text, "latin1")))?.takenAt
    ).toBe(Date.parse("2026-05-17T14:30:05Z"));
  });
});
