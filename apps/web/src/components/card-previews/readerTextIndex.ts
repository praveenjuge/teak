/**
 * The reader's text with its whitespace collapsed (`normalizeReaderText`),
 * mapped back to the raw text of the page's text nodes, so a highlight's
 * offsets (into the collapsed text, as the server stores them) and a DOM
 * selection (in the raw text) can be turned into each other.
 */

const SPACE = /\s/u;

export interface ReaderTextMap {
  /** For each raw position (and one past the end): the first collapsed
   * character at or after it. */
  rawToText: number[];
  /** The collapsed text: what highlights' offsets point into. */
  text: string;
  /** For each collapsed character: where its raw character is. */
  textToRaw: number[];
}

/** Collapses `raw` the way the server collapses the article's text. */
export const buildReaderTextMap = (raw: string): ReaderTextMap => {
  let text = "";
  const textToRaw: number[] = [];
  const rawToText: number[] = [];
  let pendingSpace = -1;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] as string;
    if (SPACE.test(char)) {
      if (text.length > 0 && pendingSpace < 0) {
        pendingSpace = index;
      }
      rawToText[index] = text.length;
      continue;
    }
    if (pendingSpace >= 0) {
      // The run before this character is one space, at its first position.
      for (let back = pendingSpace; back < index; back += 1) {
        rawToText[back] = text.length;
      }
      text += " ";
      textToRaw.push(pendingSpace);
      pendingSpace = -1;
    }
    rawToText[index] = text.length;
    text += char;
    textToRaw.push(index);
  }
  rawToText[raw.length] = text.length;
  return { rawToText, text, textToRaw };
};

/**
 * The collapsed span a raw `[rawStart, rawEnd)` covers, without spaces at
 * either end, or null when it holds no text.
 */
export const textSpanOfRaw = (
  map: ReaderTextMap,
  rawStart: number,
  rawEnd: number
): { end: number; start: number } | null => {
  let start = map.rawToText[Math.max(0, rawStart)] ?? map.text.length;
  let end = map.rawToText[Math.min(rawEnd, map.rawToText.length - 1)] ?? 0;
  while (start < end && map.text[start] === " ") {
    start += 1;
  }
  while (end > start && map.text[end - 1] === " ") {
    end -= 1;
  }
  return end > start ? { start, end } : null;
};

/** The raw `[rawStart, rawEnd)` a collapsed span covers. */
export const rawRangeOfText = (
  map: ReaderTextMap,
  start: number,
  end: number
): { rawEnd: number; rawStart: number } | null => {
  const rawStart = map.textToRaw[start];
  const last = map.textToRaw[end - 1];
  if (rawStart === undefined || last === undefined || end <= start) {
    return null;
  }
  return { rawStart, rawEnd: last + 1 };
};

/**
 * Which chunk (text node) holds raw position `raw`, and where in it. An end
 * position belongs to the chunk it ends, not the next one.
 */
export const locateRaw = (
  starts: readonly number[],
  lengths: readonly number[],
  raw: number,
  edge: "start" | "end"
): { chunk: number; offset: number } | null => {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const begin = starts[middle] as number;
    const finish = begin + (lengths[middle] as number);
    const inside =
      edge === "start"
        ? raw >= begin && raw < finish
        : raw > begin && raw <= finish;
    if (inside) {
      found = middle;
      break;
    }
    if (edge === "start" ? raw < begin : raw <= begin) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (found < 0) {
    return null;
  }
  return { chunk: found, offset: raw - (starts[found] as number) };
};
