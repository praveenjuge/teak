import { describe, expect, test } from "bun:test";
import {
  findPdfStartxref,
  fontFormatOf,
  isAacAdts,
  isAsf,
  isAvi,
  isEbml,
  isFlac,
  isIsobmff,
  isMatroska,
  isMpegPs,
  isMpegTs,
  isOgg,
  isOle,
  isWav,
  isWebm,
  isZip,
  parseAacFacts,
  parseBmpDimensions,
  parseEbmlFacts,
  parseFlacFacts,
  parseFontFamily,
  parseGifDimensions,
  parseIsobmffFacts,
  parseJpegDimensions,
  parseMp3Facts,
  parseOggFacts,
  parsePdfFacts,
  parsePngDimensions,
  parseSfntTables,
  parseTiffDimensions,
  parseWavFacts,
  parseWebpDimensions,
} from "./mediaFacts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("container detection", () => {
  test("recognizes magic bytes without over-matching", () => {
    expect(isIsobmff(text("....ftypisom"))).toBe(true);
    expect(isIsobmff(text("....ftyp"))).toBe(false);
    expect(isEbml(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
    expect(isWav(text("RIFF....WAVE"))).toBe(true);
    expect(isAvi(text("RIFF....AVI "))).toBe(true);
    expect(isWav(text("RIFF....AVI "))).toBe(false);
    expect(isOgg(text("OggS"))).toBe(true);
    expect(isFlac(text("fLaC"))).toBe(true);
    expect(isAacAdts(new Uint8Array([0xff, 0xf1, 0x50, 0, 0, 0, 0]))).toBe(
      true
    );
    expect(isAacAdts(new Uint8Array([0xff, 0xf9, 0x50, 0, 0, 0, 0]))).toBe(
      false
    );
    expect(
      isAsf(
        new Uint8Array([
          0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9,
        ])
      )
    ).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x01, 0x02]))).toBe(false);
    expect(
      isOle(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    ).toBe(true);
    expect(isMpegPs(new Uint8Array([0, 0, 1, 0xba]))).toBe(true);
    const ts = new Uint8Array(377);
    ts[0] = 0x47;
    ts[188] = 0x47;
    ts[376] = 0x47;
    expect(isMpegTs(ts)).toBe(true);
    ts[188] = 0;
    expect(isMpegTs(ts)).toBe(false);
  });

  test("distinguishes matroska from webm", () => {
    const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    const withDoctype = (doctype: string): Uint8Array => {
      const out = new Uint8Array(32);
      out.set(ebml.subarray(0, 4), 0);
      out.set(text(doctype), 8);
      return out;
    };
    expect(isMatroska(withDoctype("matroska"))).toBe(true);
    expect(isWebm(withDoctype("matroska"))).toBe(false);
    expect(isWebm(withDoctype("webm"))).toBe(true);
    expect(isMatroska(withDoctype("webm"))).toBe(false);
  });

  test("classifies font flavors", () => {
    expect(fontFormatOf(new Uint8Array([0, 1, 0, 0]))).toBe("truetype");
    expect(fontFormatOf(text("OTTO"))).toBe("opentype");
    expect(fontFormatOf(text("wOFF"))).toBe("woff");
    expect(fontFormatOf(text("wOF2"))).toBe("woff2");
    expect(fontFormatOf(text("true"))).toBe("truetype");
    expect(fontFormatOf(text("xxxx"))).toBeNull();
  });
});

describe("image dimension parsers", () => {
  test("reads png, gif, jpeg, webp, bmp, and tiff headers", () => {
    const png = new Uint8Array(33);
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    png.set(text("IHDR"), 12);
    expect(parsePngDimensions(png)).toEqual({ height: 480, width: 640 });
    expect(parsePngDimensions(png.subarray(0, 20))).toBeNull();

    const gif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x10, 0x02,
    ]);
    expect(parseGifDimensions(gif)).toEqual({ height: 528, width: 800 });

    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      14, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0,
    ]);
    expect(parseJpegDimensions(jpeg)).toEqual({ height: 480, width: 640 });
    expect(parseJpegDimensions(jpeg.subarray(0, 10))).toBeNull();

    const webp = new Uint8Array(30);
    webp.set(text("RIFF"), 0);
    webp.set(text("WEBP"), 8);
    webp.set(text("VP8X"), 12);
    webp[24] = 639 % 256;
    webp[25] = Math.floor(639 / 256);
    webp[27] = 479 % 256;
    webp[28] = Math.floor(479 / 256);
    expect(parseWebpDimensions(webp)).toEqual({ height: 480, width: 640 });

    const bmp = new Uint8Array(26);
    bmp.set(text("BM"), 0);
    new DataView(bmp.buffer).setUint32(18, 100, true);
    new DataView(bmp.buffer).setUint32(22, 50, true);
    expect(parseBmpDimensions(bmp)).toEqual({ height: 50, width: 100 });

    const tiff = new Uint8Array(8 + 2 + 24);
    tiff.set(text("II*\0"), 0);
    new DataView(tiff.buffer).setUint32(4, 8, true);
    new DataView(tiff.buffer).setUint16(8, 2, true);
    new DataView(tiff.buffer).setUint16(10, 256, true);
    new DataView(tiff.buffer).setUint32(18, 320, true);
    new DataView(tiff.buffer).setUint16(22, 257, true);
    new DataView(tiff.buffer).setUint32(30, 200, true);
    expect(parseTiffDimensions(tiff)).toEqual({ height: 200, width: 320 });
    expect(parseTiffDimensions(tiff.subarray(0, 12))).toBeNull();
  });
});

describe("audio parsers", () => {
  test("mp3 reports codec without duration when xing is absent", () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    expect(parseMp3Facts(bytes)).toEqual({ codec: "mp3", container: "mp3" });
    expect(parseMp3Facts(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test("mp3 resolves xing durations", () => {
    // MPEG-1 Layer III, 128 kbps, 44100 Hz, stereo: side info is 32 bytes.
    const bytes = new Uint8Array(4 + 32 + 12);
    bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
    bytes.set(text("Xing"), 36);
    const view = new DataView(bytes.buffer);
    view.setUint32(40, 1);
    view.setUint32(44, 100);
    expect(parseMp3Facts(bytes)?.duration).toBeCloseTo(
      (100 * 1152) / 44_100,
      5
    );
  });

  test("wav resolves pcm durations and flags exotic codecs", () => {
    const header = new Uint8Array(12 + 8 + 16 + 8);
    header.set(text("RIFF"), 0);
    header.set(text("WAVE"), 8);
    header.set(text("fmt "), 12);
    new DataView(header.buffer).setUint32(16, 16, true);
    header.set([1, 0, 1, 0], 20);
    new DataView(header.buffer).setUint32(24, 8000, true);
    new DataView(header.buffer).setUint32(28, 8000, true);
    header.set(text("data"), 36);
    new DataView(header.buffer).setUint32(40, 16_000, true);
    expect(parseWavFacts(header, 16_044)?.duration).toBeCloseTo(2, 5);
    // Without the full object size a truncated window cannot confirm the
    // data chunk length, so durations stay absent instead of guessing.
    expect(parseWavFacts(header)?.duration).toBeUndefined();
    header[20] = 0x11;
    expect(parseWavFacts(header)?.codec).toBe("wav-format-17");
  });

  test("flac resolves streaminfo durations", () => {
    const bytes = new Uint8Array(42);
    bytes.set(text("fLaC"), 0);
    bytes[4] = 0x10;
    bytes[7] = 34;
    const view = new DataView(bytes.buffer);
    view.setUint32(10, 44_100 << 12);
    view.setUint32(18, 44_100);
    expect(parseFlacFacts(bytes)?.duration).toBeCloseTo(1, 5);
    expect(parseFlacFacts(bytes.subarray(0, 10))).toBeNull();
  });

  test("ogg identifies codecs and last-page durations", () => {
    const packet = new Uint8Array(30);
    packet[0] = 1;
    packet.set(text("vorbis"), 1);
    new DataView(packet.buffer).setUint32(12, 44_100, true);
    const page = new Uint8Array(27 + 1 + packet.length);
    page.set(text("OggS"), 0);
    page[26] = 1;
    page[27] = packet.length;
    page.set(packet, 28);
    const facts = parseOggFacts(page);
    expect(facts?.codec).toBe("vorbis");
    // Last-page scan over the head window finds the BOS page granule (0),
    // which yields no duration — only a real tail granule would.
    expect(facts?.duration).toBeUndefined();
    expect(parseOggFacts(text("nope"))).toBeNull();
  });

  test("aac accepts adts sync words", () => {
    expect(
      parseAacFacts(new Uint8Array([0xff, 0xf1, 0x50, 0, 0, 0, 0]))
    ).toEqual({ codec: "aac", container: "adts" });
    expect(parseAacFacts(new Uint8Array(7))).toBeNull();
  });
});

describe("isobmff and ebml parsers", () => {
  test("isobmff rejects truncated boxes", () => {
    expect(parseIsobmffFacts(text("....ftypisom"))?.container).toBe("mp4");
    expect(parseIsobmffFacts(text("nope"))).toBeNull();
    const bad = new Uint8Array(20);
    bad.set(text("....ftypisom"), 0);
    new DataView(bad.buffer).setUint32(12, 0xff_ff_ff_ff);
    expect(parseIsobmffFacts(bad)?.duration).toBeUndefined();
  });

  test("ebml resolves webm durations, dims, and codecs", () => {
    const bytes = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
      0x18, 0x53, 0x80, 0x67, 0xff, 0x15, 0x49, 0xa9, 0x66, 0x92, 0x2a, 0xd7,
      0xb1, 0x83, 0x0f, 0x42, 0x40, 0x44, 0x89, 0x88, 0x40, 0x59, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x16, 0x54, 0xae, 0x6b, 0x94, 0xae, 0x92, 0xd7,
      0x81, 0x01, 0x86, 0x85, 0x56, 0x5f, 0x56, 0x50, 0x38, 0xb0, 0x82, 0x02,
      0x80, 0xba, 0x82, 0x01, 0xe0,
    ]);
    const facts = parseEbmlFacts(bytes);
    expect(facts?.container).toBe("webm");
    expect(facts?.codec).toBe("V_VP8");
    expect(facts?.width).toBe(640);
    expect(facts?.height).toBe(480);
    // Duration 100 in timecode units of 1ms resolves to 0.1 seconds.
    expect(facts?.duration).toBeCloseTo(0.1, 5);
    expect(parseEbmlFacts(text("nope"))).toBeNull();
  });
});

describe("pdf and font parsers", () => {
  test("pdf detects encryption and startxref offsets", () => {
    const head = text("%PDF-1.7\n1 0 obj\n<< /Encrypt 5 0 R >>\nendobj\n");
    expect(parsePdfFacts(head)?.encrypted).toBe(true);
    expect(parsePdfFacts(text("%PDF-1.4\n"))?.encrypted).toBeUndefined();
    expect(parsePdfFacts(text("nope"))).toBeNull();
    expect(findPdfStartxref(text("trailer\nstartxref\n12345\n%%EOF"))).toBe(
      12_345
    );
    expect(findPdfStartxref(text("no trailer here"))).toBeNull();
  });

  test("sfnt tables reject corrupt directories", () => {
    expect(parseSfntTables(new Uint8Array(20))).toBeNull();
    const bytes = new Uint8Array(12 + 16);
    new DataView(bytes.buffer).setUint16(4, 1);
    bytes.set(text("name"), 12);
    new DataView(bytes.buffer).setUint32(20, 28);
    new DataView(bytes.buffer).setUint32(24, 100);
    const tables = parseSfntTables(bytes);
    expect(tables?.get("name")).toEqual({ length: 100, offset: 28 });
    expect(parseFontFamily(bytes, { length: 100, offset: 28 })).toBeNull();
  });

  test("name tables prefer windows unicode family names", () => {
    const family = text("Graphics");
    const utf16 = new Uint8Array(family.length * 2);
    for (let index = 0; index < family.length; index += 1) {
      utf16[index * 2 + 1] = family[index] ?? 0;
    }
    const table = new Uint8Array(6 + 24 + utf16.length * 2);
    const view = new DataView(table.buffer);
    view.setUint16(2, 2);
    view.setUint16(4, 30);
    // Macintosh Roman entry first, Windows Unicode second.
    view.setUint16(6, 1);
    view.setUint16(12, 1);
    view.setUint16(14, family.length);
    view.setUint16(16, 0);
    view.setUint16(18, 3);
    view.setUint16(20, 1);
    view.setUint16(24, 1);
    view.setUint16(26, utf16.length);
    view.setUint16(28, family.length);
    table.set(family, 30);
    table.set(utf16, 30 + family.length);
    expect(parseFontFamily(table, { length: table.length, offset: 0 })).toBe(
      "Graphics"
    );
  });
});
