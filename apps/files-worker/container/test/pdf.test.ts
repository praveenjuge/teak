import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { RENDERER_URL, renderFixture } from "./helpers";

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const paeth = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
};

/** How many pixels of an 8-bit RGB or RGBA PNG are dark, like text. */
function darkPixels(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const channels = bytes[25] === 6 ? 4 : 3;
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8)
    );
    if (type === "IDAT") {
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const rowBytes = width * channels;
  let previous = new Uint8Array(rowBytes);
  let dark = 0;
  for (let start = 0; start + 1 + rowBytes <= raw.length; ) {
    const filter = raw[start] as number;
    const row = new Uint8Array(raw.subarray(start + 1, start + 1 + rowBytes));
    for (let index = 0; index < rowBytes; index++) {
      const left = index >= channels ? (row[index - channels] as number) : 0;
      const up = previous[index] as number;
      const upLeft =
        index >= channels ? (previous[index - channels] as number) : 0;
      const predictor = [
        0,
        left,
        up,
        Math.floor((left + up) / 2),
        paeth(left, up, upLeft),
      ][filter] as number;
      row[index] = ((row[index] as number) + predictor) % 256;
    }
    for (let pixel = 0; pixel < rowBytes; pixel += channels) {
      if ((row[pixel] as number) < 96 && (row[pixel + 1] as number) < 96) {
        dark += 1;
      }
    }
    previous = row;
    start += 1 + rowBytes;
  }
  return dark;
}

describe.skipIf(!RENDERER_URL)("renderer PDF jobs", () => {
  test("draws text set in a standard font the PDF does not embed", async () => {
    // Each page of the fixture is one line of Helvetica, not embedded.
    const result = await renderFixture("/pdf/page?max=800", "sixty-pages.pdf");
    expect(result.status).toBe(200);
    expect(darkPixels(result.parts.page)).toBeGreaterThan(200);
  });

  test("renders page one with its long side at max", async () => {
    const result = await renderFixture("/pdf/page?max=400", "sixty-pages.pdf");
    expect(result.status).toBe(200);
    expect(result.manifest?.facts).toBeNull();
    expect(result.manifest?.pages).toBe(60);
    const size = pngSize(result.parts.page);
    expect(result.manifest?.page).toEqual(size);
    // A US Letter page is 612×792 points: 400 tall makes it 309.1 wide.
    expect(size.height).toBe(400);
    expect(Math.abs(size.width - 309.1)).toBeLessThan(1);
  });

  test("a PDF without a text layer answers with no text part", async () => {
    const result = await renderFixture("/pdf/text", "no-text.pdf");
    expect(result.status).toBe(200);
    expect(result.manifest?.pages).toBe(1);
    expect(result.manifest?.parts).toEqual([]);
  });

  test("text stops at maxPages and says it was truncated", async () => {
    const result = await renderFixture(
      "/pdf/text?maxPages=50",
      "sixty-pages.pdf"
    );
    expect(result.status).toBe(200);
    expect(result.manifest?.pages).toBe(60);
    expect(result.manifest?.truncated).toBe(true);
    const text = new TextDecoder().decode(result.parts.text);
    expect(text.startsWith("Marker-001.")).toBe(true);
    expect(text).toContain("Marker-050.");
    expect(text).not.toContain("Marker-051.");
    expect(result.manifest?.parts).toEqual([
      {
        name: "text",
        type: "text/plain; charset=utf-8",
        length: result.parts.text.byteLength,
      },
    ]);
  });

  test("text is complete when it covers every page", async () => {
    const result = await renderFixture(
      "/pdf/text?maxPages=500",
      "sixty-pages.pdf"
    );
    expect(result.manifest?.truncated).toBe(false);
    expect(new TextDecoder().decode(result.parts.text)).toContain(
      "Marker-060."
    );
  });

  test("text is capped at maxChars", async () => {
    const result = await renderFixture(
      "/pdf/text?maxChars=20",
      "sixty-pages.pdf"
    );
    expect(result.manifest?.truncated).toBe(true);
    expect(new TextDecoder().decode(result.parts.text)).toBe(
      // pdftotext ends each page with a form feed.
      "Marker-001.\n\n\fMarker"
    );
  });

  test.each(["/pdf/page", "/pdf/text"])(
    "%s refuses a password-protected PDF",
    async (path) => {
      const result = await renderFixture(path, "encrypted.pdf");
      expect(result.status).toBe(415);
      expect(result.error?.message).toContain("password");
    }
  );
});
