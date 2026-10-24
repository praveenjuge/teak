/**
 * The reader's highlights in the page: the article body's text nodes as one
 * text (`readerTextIndex.ts`), selections and clicks turned into offsets
 * into it, and highlights painted with the CSS Custom Highlight API, which
 * never changes the React-rendered tree.
 */

import { anchorQuote } from "@teak/convex/shared/highlights/anchor";
import {
  buildReaderTextMap,
  locateRaw,
  type ReaderTextMap,
  rawRangeOfText,
  textSpanOfRaw,
} from "./readerTextIndex";

/** The painted highlights, and the one flashed or open. */
export const HIGHLIGHT_NAME = "teak-highlight";
export const ACTIVE_HIGHLIGHT_NAME = "teak-highlight-active";

export interface BodyTextIndex {
  body: HTMLElement;
  lengths: number[];
  map: ReaderTextMap;
  nodes: Text[];
  starts: number[];
}

/** Every text node in the article body, in order, as one text. */
export const indexBodyText = (body: HTMLElement): BodyTextIndex => {
  const walker = body.ownerDocument.createTreeWalker(
    body,
    NodeFilter.SHOW_TEXT
  );
  const nodes: Text[] = [];
  const starts: number[] = [];
  const lengths: number[] = [];
  let raw = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    nodes.push(text);
    starts.push(raw.length);
    lengths.push(text.data.length);
    raw += text.data;
  }
  return { body, lengths, map: buildReaderTextMap(raw), nodes, starts };
};

/** The raw offset of a boundary point inside the body. */
const rawOffsetOf = (index: BodyTextIndex, node: Node, offset: number) => {
  const range = index.body.ownerDocument.createRange();
  range.setStart(index.body, 0);
  range.setEnd(node, offset);
  return range.toString().length;
};

/**
 * The part of `range` inside the article body: the header, title and footer
 * are left out. Null when it has none of the body.
 */
export const clipToBody = (range: Range, body: HTMLElement): Range | null => {
  if (!range.intersectsNode(body)) {
    return null;
  }
  const clipped = range.cloneRange();
  const whole = body.ownerDocument.createRange();
  whole.selectNodeContents(body);
  if (clipped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) {
    clipped.setStart(whole.startContainer, whole.startOffset);
  }
  if (clipped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) {
    clipped.setEnd(whole.endContainer, whole.endOffset);
  }
  return clipped.collapsed ? null : clipped;
};

/** A range in the body as a highlight's offsets, quote and context. */
export const spanOfRange = (index: BodyTextIndex, range: Range) => {
  const span = textSpanOfRaw(
    index.map,
    rawOffsetOf(index, range.startContainer, range.startOffset),
    rawOffsetOf(index, range.endContainer, range.endOffset)
  );
  return span
    ? { ...span, quote: index.map.text.slice(span.start, span.end) }
    : null;
};

/** The DOM range of offsets into the body's text. */
export const rangeOfSpan = (
  index: BodyTextIndex,
  start: number,
  end: number
): Range | null => {
  const raw = rawRangeOfText(index.map, start, end);
  if (!raw) {
    return null;
  }
  const from = locateRaw(index.starts, index.lengths, raw.rawStart, "start");
  const to = locateRaw(index.starts, index.lengths, raw.rawEnd, "end");
  if (!(from && to)) {
    return null;
  }
  const range = index.body.ownerDocument.createRange();
  range.setStart(index.nodes[from.chunk] as Text, from.offset);
  range.setEnd(index.nodes[to.chunk] as Text, to.offset);
  return range;
};

/** The body text offset under a point, or null outside its text. */
export const textOffsetAtPoint = (
  index: BodyTextIndex,
  x: number,
  y: number
): number | null => {
  const doc = index.body.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offset: number; offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | undefined;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    node = range?.startContainer;
    offset = range?.startOffset ?? 0;
  }
  if (!(node && index.body.contains(node))) {
    return null;
  }
  return index.map.rawToText[rawOffsetOf(index, node, offset)] ?? null;
};

export interface StoredHighlight {
  _id: string;
  end?: number;
  prefix?: string;
  quote: string;
  start?: number;
  suffix?: string;
  unanchored?: boolean;
}

export interface PlacedHighlight {
  end: number;
  id: string;
  start: number;
}

/**
 * Where each highlight is in the body's text, found again by its quote and
 * context (its offsets only choose between repeats). Ones not found, and
 * imported ones not yet anchored, are left out.
 */
export const placeHighlights = (
  text: string,
  highlights: readonly StoredHighlight[]
): PlacedHighlight[] =>
  highlights.flatMap((highlight) => {
    if (highlight.unanchored) {
      return [];
    }
    if (
      highlight.start !== undefined &&
      highlight.end !== undefined &&
      text.slice(highlight.start, highlight.end) === highlight.quote
    ) {
      return [
        { id: highlight._id, start: highlight.start, end: highlight.end },
      ];
    }
    const anchor = anchorQuote(text, {
      quote: highlight.quote,
      ...(highlight.prefix ? { prefix: highlight.prefix } : {}),
      ...(highlight.suffix ? { suffix: highlight.suffix } : {}),
      ...(highlight.start === undefined ? {} : { start: highlight.start }),
    });
    return anchor
      ? [{ id: highlight._id, start: anchor.start, end: anchor.end }]
      : [];
  });

interface HighlightRegistry {
  delete: (name: string) => void;
  set: (name: string, value: unknown) => void;
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;

const registry = (): {
  Highlight: HighlightConstructor;
  highlights: HighlightRegistry;
} | null => {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightConstructor })
    .Highlight;
  return css?.highlights && Highlight
    ? { Highlight, highlights: css.highlights }
    : null;
};

/** Whether this browser can paint highlights in the text. */
export const canPaintHighlights = (): boolean => registry() !== null;

/** Paints `ranges` under `name`; an empty list clears it. */
export const paintRanges = (name: string, ranges: Range[]): void => {
  const api = registry();
  if (!api) {
    return;
  }
  if (ranges.length === 0) {
    api.highlights.delete(name);
    return;
  }
  api.highlights.set(name, new api.Highlight(...ranges));
};
