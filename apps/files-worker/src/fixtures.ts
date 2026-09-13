import { FILE_FORMATS } from "@teak/files-core";
import { zipSync } from "fflate";

export interface FormatFixture {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const u16be = (value: number): Uint8Array =>
  new Uint8Array([(value >> 8) & 0xff, value & 0xff]);

const u32be = (value: number): Uint8Array =>
  new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const u32le = (value: number): Uint8Array =>
  new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);

const box = (type: string, ...payloads: Uint8Array[]): Uint8Array => {
  const size = 8 + payloads.reduce((sum, payload) => sum + payload.length, 0);
  return concat(u32be(size), text(type), ...payloads);
};

const ooxmlZip = (entries: Record<string, Uint8Array>): Uint8Array =>
  zipSync({
    "[Content_Types].xml": text("<Types/>"),
    ...entries,
  });

const minimalPdf = (): Uint8Array => {
  // Single-page PDF with a plain xref table so the bounded page-count walk
  // resolves /Root -> /Pages -> /Count without following streams.
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n",
  ];
  const header = "%PDF-1.7\n";
  let body = header;
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefOffset = body.length;
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return text(body);
};

const minimalGif = (): Uint8Array =>
  // 1x1 transparent GIF89a: header, logical screen descriptor, global color
  // table, graphic control extension, image descriptor, data, trailer.
  new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);

const minimalPng = (): Uint8Array =>
  concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    u32be(13),
    text("IHDR"),
    u32be(1),
    u32be(1),
    new Uint8Array([8, 2, 0, 0, 0]),
    u32be(0),
    u32be(0),
    text("IEND"),
    u32be(0)
  );

const minimalJpeg = (): Uint8Array =>
  concat(
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0xff, 0xe0]),
    u16be(16),
    text("JFIF\0"),
    new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]),
    new Uint8Array([0xff, 0xc0]),
    u16be(11),
    new Uint8Array([8]),
    u16be(1),
    u16be(1),
    new Uint8Array([1, 1, 0x11, 0, 0xff, 0xd9])
  );

const minimalWebp = (): Uint8Array => {
  const vp8x = concat(
    text("VP8X"),
    u32le(10),
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  );
  return concat(text("RIFF"), u32le(4 + vp8x.length), text("WEBP"), vp8x);
};

const minimalBmp = (): Uint8Array =>
  concat(
    text("BM"),
    u32le(58),
    u32le(0),
    u32le(54),
    u32le(40),
    u32le(1),
    u32le(1),
    new Uint8Array([1, 0, 24, 0]),
    new Uint8Array(24)
  );

const minimalMp4 = (brand: string): Uint8Array => {
  const mvhd = box(
    "mvhd",
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    u32be(1000),
    u32be(5000)
  );
  const tkhd = box(
    "tkhd",
    new Uint8Array(76),
    u32be(640 << 16),
    u32be(480 << 16)
  );
  const stsd = box("stsd", new Uint8Array(8), box("avc1", new Uint8Array(8)));
  const trak = box("trak", tkhd, box("mdia", box("minf", box("stbl", stsd))));
  return concat(box("ftyp", text(brand), u32be(0)), box("moov", mvhd, trak));
};

const minimalEbml = (doctype: string): Uint8Array =>
  concat(
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x8b]),
    new Uint8Array([0x42, 0x82, 0x88]),
    text(doctype),
    new Uint8Array([0x18, 0x53, 0x80, 0x67, 0xff])
  );

const minimalWav = (): Uint8Array =>
  concat(
    text("RIFF"),
    u32le(44),
    text("WAVE"),
    text("fmt "),
    u32le(16),
    new Uint8Array([1, 0, 1, 0]),
    u32le(8000),
    u32le(8000),
    new Uint8Array([1, 0, 8, 0]),
    text("data"),
    u32le(8000),
    new Uint8Array(8000)
  );

const minimalFlac = (): Uint8Array => {
  // fLaC marker + STREAMINFO block: 44100 Hz, 16 total samples.
  const info = new Uint8Array(34);
  const view = new DataView(info.buffer);
  view.setUint32(0, 0x0a_c4_44_10);
  view.setUint32(4, 0x00_10_00_00);
  view.setUint32(8, 16);
  return concat(
    text("fLaC"),
    new Uint8Array([0x10]),
    new Uint8Array([0, 0, 34]),
    info
  );
};

const minimalMp3 = (): Uint8Array =>
  concat(
    text("ID3"),
    new Uint8Array([4, 0, 0, 0, 0, 0, 0]),
    new Uint8Array([0xff, 0xfb, 0x90, 0x00])
  );

const minimalAdts = (): Uint8Array =>
  new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]);

const minimalOgg = (): Uint8Array => {
  // Single BOS page carrying an OpusHead identification packet.
  const packet = concat(
    text("OpusHead"),
    new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  );
  return concat(
    text("OggS"),
    new Uint8Array([0, 2]),
    new Uint8Array(8),
    u32le(1),
    u32le(0),
    u32le(0),
    new Uint8Array([1, packet.length]),
    packet
  );
};

const minimalSfnt = (flavor: "truetype" | "opentype"): Uint8Array => {
  const family = text("TestFamily");
  const familyUtf16 = new Uint8Array(family.length * 2);
  for (let index = 0; index < family.length; index += 1) {
    familyUtf16[index * 2 + 1] = family[index] ?? 0;
  }
  // name table: format 0, 1 record (Windows/Unicode/full), string storage.
  const nameTable = concat(
    u16be(0),
    u16be(1),
    u16be(18),
    u16be(3),
    u16be(1),
    u16be(0x04_09),
    u16be(1),
    u16be(familyUtf16.length),
    u16be(0),
    familyUtf16
  );
  const nameOffset = 12 + 16;
  return concat(
    flavor === "truetype" ? new Uint8Array([0, 1, 0, 0]) : text("OTTO"),
    u16be(1),
    u16be(16),
    u16be(0),
    u16be(0),
    text("name"),
    u32be(0),
    u32be(nameOffset),
    u32be(nameTable.length),
    nameTable
  );
};

const oleHeader = (): Uint8Array => {
  const bytes = new Uint8Array(512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return bytes;
};

const zipBytes = (): Uint8Array => zipSync({ "files/a.txt": text("hello") });

const builders: Record<string, () => FormatFixture> = {
  "design-tokens": () => ({
    bytes: text('{"color":{"$value":"#ffffff"}}'),
    fileName: "theme.tokens.json",
    mimeType: "application/json",
  }),
  "tailwind-config": () => ({
    bytes: text("module.exports = { theme: {} };"),
    fileName: "tailwind.config.js",
    mimeType: "application/javascript",
  }),
  "css-variables": () => ({
    bytes: text(":root { --brand: #000; }"),
    fileName: "theme.css",
    mimeType: "text/css",
  }),
  json: () => ({
    bytes: text('{"hello":"world"}'),
    fileName: "data.json",
    mimeType: "application/json",
  }),
  tsx: () => ({
    bytes: text("export const A = () => <div />;"),
    fileName: "a.tsx",
    mimeType: "text/plain",
  }),
  jsx: () => ({
    bytes: text("export const A = () => null;"),
    fileName: "a.jsx",
    mimeType: "text/plain",
  }),
  vue: () => ({
    bytes: text("<template><div /></template>"),
    fileName: "a.vue",
    mimeType: "text/plain",
  }),
  svelte: () => ({
    bytes: text("<h1>hi</h1>"),
    fileName: "a.svelte",
    mimeType: "text/plain",
  }),
  html: () => ({
    bytes: text("<!doctype html><html><body>hi</body></html>"),
    fileName: "a.html",
    mimeType: "text/html",
  }),
  css: () => ({
    bytes: text("body { color: red; }"),
    fileName: "a.css",
    mimeType: "text/css",
  }),
  markdown: () => ({
    bytes: text("# Hello\n\nWorld.\n"),
    fileName: "note.md",
    mimeType: "text/markdown",
  }),
  mdx: () => ({
    bytes: text("# Hello\n\n<Chart />\n"),
    fileName: "note.mdx",
    mimeType: "text/mdx",
  }),
  text: () => ({
    bytes: text("plain text\n"),
    fileName: "note.txt",
    mimeType: "text/plain",
  }),
  rtf: () => ({
    bytes: text("{\\rtf1\\ansi Hello}"),
    fileName: "note.rtf",
    mimeType: "application/rtf",
  }),
  pdf: () => ({
    bytes: minimalPdf(),
    fileName: "a.pdf",
    mimeType: "application/pdf",
  }),
  word: () => ({
    bytes: ooxmlZip({ "word/document.xml": text("<w:doc/>") }),
    fileName: "a.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  "word-legacy": () => ({
    bytes: oleHeader(),
    fileName: "a.doc",
    mimeType: "application/msword",
  }),
  powerpoint: () => ({
    bytes: ooxmlZip({
      "ppt/presentation.xml": text("<p:presentation/>"),
      "ppt/slides/slide1.xml": text("<p:slide/>"),
    }),
    fileName: "a.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }),
  "powerpoint-legacy": () => ({
    bytes: oleHeader(),
    fileName: "a.ppt",
    mimeType: "application/vnd.ms-powerpoint",
  }),
  excel: () => ({
    bytes: ooxmlZip({ "xl/workbook.xml": text("<x:workbook/>") }),
    fileName: "a.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
  "excel-legacy": () => ({
    bytes: oleHeader(),
    fileName: "a.xls",
    mimeType: "application/vnd.ms-excel",
  }),
  csv: () => ({
    bytes: text("a,b\n1,2\n"),
    fileName: "data.csv",
    mimeType: "text/csv",
  }),
  zip: () => ({
    bytes: zipBytes(),
    fileName: "archive.zip",
    mimeType: "application/zip",
  }),
  figma: () => ({
    bytes: zipBytes(),
    fileName: "design.fig",
    mimeType: "application/octet-stream",
  }),
  pages: () => ({
    bytes: zipBytes(),
    fileName: "doc.pages",
    mimeType: "application/octet-stream",
  }),
  numbers: () => ({
    bytes: zipBytes(),
    fileName: "sheet.numbers",
    mimeType: "application/octet-stream",
  }),
  gif: () => ({
    bytes: minimalGif(),
    fileName: "a.gif",
    mimeType: "image/gif",
  }),
  webm: () => ({
    bytes: minimalEbml("webm"),
    fileName: "a.webm",
    mimeType: "video/webm",
  }),
  "webm-audio": () => ({
    bytes: minimalEbml("webm"),
    fileName: "a.webm",
    mimeType: "audio/webm",
  }),
  mp4: () => ({
    bytes: minimalMp4("isom"),
    fileName: "a.mp4",
    mimeType: "video/mp4",
  }),
  quicktime: () => ({
    bytes: minimalMp4("qt  "),
    fileName: "a.mov",
    mimeType: "video/quicktime",
  }),
  video: () => ({
    bytes: minimalEbml("matroska"),
    fileName: "a.mkv",
    mimeType: "video/x-matroska",
  }),
  png: () => ({
    bytes: minimalPng(),
    fileName: "a.png",
    mimeType: "image/png",
  }),
  jpeg: () => ({
    bytes: minimalJpeg(),
    fileName: "a.jpg",
    mimeType: "image/jpeg",
  }),
  webp: () => ({
    bytes: minimalWebp(),
    fileName: "a.webp",
    mimeType: "image/webp",
  }),
  avif: () => ({
    bytes: box("ftyp", text("avif"), u32be(0)),
    fileName: "a.avif",
    mimeType: "image/avif",
  }),
  svg: () => ({
    bytes: text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    fileName: "a.svg",
    mimeType: "image/svg+xml",
  }),
  heic: () => ({
    bytes: box("ftyp", text("heic"), u32be(0)),
    fileName: "a.heic",
    mimeType: "image/heic",
  }),
  bitmap: () => ({
    bytes: minimalBmp(),
    fileName: "a.bmp",
    mimeType: "image/bmp",
  }),
  "mpeg-audio": () => ({
    bytes: minimalMp3(),
    fileName: "a.mp3",
    mimeType: "audio/mpeg",
  }),
  "wave-audio": () => ({
    bytes: minimalWav(),
    fileName: "a.wav",
    mimeType: "audio/wav",
  }),
  "mp4-audio": () => ({
    bytes: minimalMp4("M4A "),
    fileName: "a.m4a",
    mimeType: "audio/mp4",
  }),
  "aac-audio": () => ({
    bytes: minimalAdts(),
    fileName: "a.aac",
    mimeType: "audio/aac",
  }),
  "other-audio": () => ({
    bytes: minimalFlac(),
    fileName: "a.flac",
    mimeType: "audio/flac",
  }),
  "font-truetype": () => ({
    bytes: minimalSfnt("truetype"),
    fileName: "a.ttf",
    mimeType: "font/ttf",
  }),
  "font-opentype": () => ({
    bytes: minimalSfnt("opentype"),
    fileName: "a.otf",
    mimeType: "font/otf",
  }),
  "font-woff": () => ({
    bytes: concat(text("wOFF"), new Uint8Array(40)),
    fileName: "a.woff",
    mimeType: "font/woff",
  }),
  "font-woff2": () => ({
    bytes: concat(text("wOF2"), new Uint8Array(40)),
    fileName: "a.woff2",
    mimeType: "font/woff2",
  }),
};

export const variantFixtures = {
  oggOpus: (): FormatFixture => ({
    bytes: minimalOgg(),
    fileName: "a.ogg",
    mimeType: "audio/ogg",
  }),
  opaqueBytes: (): Uint8Array =>
    // No recognized magic: exercises the validated-claim fallback.
    new Uint8Array([0x07, 0x13, 0x37, 0x42, 0x55, 0x66, 0x77, 0x88]),
};

export const fixtureForFormat = (formatId: string): FormatFixture => {
  const builder = builders[formatId];
  if (!builder) {
    throw new Error(`missing fixture for format ${formatId}`);
  }
  return builder();
};

/** Every declared format must have an upload/finalization fixture. */
export const assertFixtureCoverage = (): void => {
  const missing = FILE_FORMATS.map((format) => format.id).filter(
    (id) => builders[id] === undefined
  );
  if (missing.length > 0) {
    throw new Error(`missing fixtures for formats: ${missing.join(", ")}`);
  }
};
