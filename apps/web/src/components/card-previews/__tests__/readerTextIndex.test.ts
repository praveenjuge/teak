import { describe, expect, test } from "bun:test";
import { normalizeReaderText } from "@teak/convex/shared/highlights/anchor";
import {
  buildReaderTextMap,
  locateRaw,
  rawRangeOfText,
  textSpanOfRaw,
} from "../readerTextIndex";

const RAW = "\n  Gardens\n\nPlant  marigolds\tnow.\n\nWater\n";

describe("buildReaderTextMap", () => {
  test("collapses the text exactly as the server does", () => {
    expect(buildReaderTextMap(RAW).text).toBe(normalizeReaderText(RAW));
  });

  test("each collapsed character points back at its raw one", () => {
    const map = buildReaderTextMap(RAW);
    for (const [index, char] of map.text.split("").entries()) {
      const raw = RAW[map.textToRaw[index] as number] as string;
      expect(char === " " ? /\s/u.test(raw) : raw === char).toBe(true);
    }
  });
});

describe("a selection's offsets", () => {
  const map = buildReaderTextMap(RAW);

  test("map to the plain-text range of what was selected", () => {
    const rawStart = RAW.indexOf("marigolds");
    const rawEnd = RAW.indexOf("now.") + "now.".length;
    const span = textSpanOfRaw(map, rawStart, rawEnd);
    expect(span && map.text.slice(span.start, span.end)).toBe("marigolds now.");
  });

  test("leave out the whitespace at either end", () => {
    const span = textSpanOfRaw(
      map,
      RAW.indexOf("\n\nPlant"),
      RAW.indexOf("Plant") + "Plant  ".length
    );
    expect(span && map.text.slice(span.start, span.end)).toBe("Plant");
  });

  test("hold nothing when only whitespace is selected", () => {
    expect(textSpanOfRaw(map, 0, 3)).toBeNull();
  });

  test("come back to the same raw text", () => {
    const start = map.text.indexOf("Plant marigolds");
    const raw = rawRangeOfText(map, start, start + "Plant marigolds".length);
    expect(raw && RAW.slice(raw.rawStart, raw.rawEnd)).toBe("Plant  marigolds");
  });
});

describe("locateRaw", () => {
  const starts = [0, 2, 2];
  const lengths = [2, 0, 3];

  test("a start belongs to the node it begins, an end to the node it ends", () => {
    expect(locateRaw(starts, lengths, 2, "start")).toEqual({
      chunk: 2,
      offset: 0,
    });
    expect(locateRaw(starts, lengths, 2, "end")).toEqual({
      chunk: 0,
      offset: 2,
    });
    expect(locateRaw(starts, lengths, 5, "end")).toEqual({
      chunk: 2,
      offset: 3,
    });
    expect(locateRaw(starts, lengths, 5, "start")).toBeNull();
  });
});
