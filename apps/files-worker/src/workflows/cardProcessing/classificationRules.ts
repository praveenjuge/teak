import { normalizeQuoteContent } from "@teak/convex/card/quoteFormatting";
import type { CardType } from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import {
  type Color,
  extractPaletteColors,
  MAX_COLOR_NAME_WORDS,
  parseColorString,
} from "@teak/convex/shared/utils/colorUtils";

export interface PaletteSource {
  content?: unknown;
  notes?: unknown;
  tags?: unknown;
}

const STRONG_CONFIDENCE = 0.97;
const MEDIUM_CONFIDENCE = 0.9;
const PALETTE_CONFIDENCE = 0.88;
const DEFAULT_CONFIDENCE = 0.7;

export interface DbColor {
  hex: string;
  hsl?: { h: number; s: number; l: number };
  name?: string;
  rgb?: { r: number; g: number; b: number };
}

export const toDbColor = (color: Color): DbColor => ({
  hex: color.hex.toUpperCase(),
  ...(color.name ? { name: color.name } : {}),
  ...(color.rgb ? { rgb: color.rgb } : {}),
  ...(color.hsl ? { hsl: color.hsl } : {}),
});

export const colorsMatch = (
  existing: readonly DbColor[] | undefined,
  next: readonly DbColor[]
): boolean => {
  if (!existing) {
    return next.length === 0;
  }

  if (existing.length !== next.length) {
    return false;
  }

  return next.every((color, index) => {
    const candidate = existing[index];
    if (!candidate) {
      return false;
    }

    const hexMatch = candidate.hex?.toUpperCase() === color.hex.toUpperCase();
    const nameMatch = (candidate.name ?? "") === (color.name ?? "");
    const rgbMatch =
      !(candidate.rgb || color.rgb) ||
      (candidate.rgb &&
        color.rgb &&
        candidate.rgb.r === color.rgb.r &&
        candidate.rgb.g === color.rgb.g &&
        candidate.rgb.b === color.rgb.b);
    const hslMatch =
      !(candidate.hsl || color.hsl) ||
      (candidate.hsl &&
        color.hsl &&
        candidate.hsl.h === color.hsl.h &&
        candidate.hsl.s === color.hsl.s &&
        candidate.hsl.l === color.hsl.l);

    return hexMatch && nameMatch && rgbMatch && hslMatch;
  });
};

export const buildPaletteAnalysisText = (card: PaletteSource): string => {
  const sections: string[] = [];

  if (typeof card.content === "string" && card.content.trim()) {
    sections.push(card.content);
  }

  if (typeof card.notes === "string" && card.notes.trim()) {
    sections.push(`Notes: ${card.notes}`);
  }

  if (Array.isArray(card.tags) && card.tags.length > 0) {
    sections.push(`Tags: ${card.tags.join(", ")}`);
  }

  return sections.join("\n").trim();
};

const hasPaletteHint = (card: PaletteSource): boolean => {
  const text = buildPaletteAnalysisText(card).toLowerCase();
  const paletteHints = [
    "palette",
    "color palette",
    "brand colors",
    "brand palette",
    "swatch",
    "swatches",
    "colorway",
  ];
  const tagHints = (Array.isArray(card.tags) ? card.tags : []).some(
    (tag: string) => typeof tag === "string" && /palette|color/iu.test(tag)
  );
  return paletteHints.some((hint) => text.includes(hint)) || tagHints;
};

export const MAX_COLOR_FN_ARG_CHARS = 64;
const COLOR_FN_ARGS = `\\([^()]{0,${MAX_COLOR_FN_ARG_CHARS}}\\)`;
const COLOR_CODE_PATTERN = new RegExp(
  `#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})\\b|rgba?${COLOR_FN_ARGS}|hsla?${COLOR_FN_ARGS}`,
  "gi"
);
const COLOR_LABEL_PATTERN =
  /^(?:--[\w-]+\s*[:=]\s*|[a-z][\w\s-]{0,32}?(?:\s*[:=]\s*|\s+[-–]\s+))(.+)$/iu;
const COLOR_WORD_DELIMITER_PATTERN = /\s+/;
const PLAIN_WORD_PATTERN = /^[a-z]+$/iu;
const FUNCTIONAL_COLOR_PATTERN = new RegExp(
  `^(?:rgba?|hsla?)${COLOR_FN_ARGS}$`,
  "iu"
);
const NUMERIC_REFERENCE_PATTERN = /^#\d{3,4}$/u;
const REPEATED_DIGIT_PATTERN = /^#(\d)\1+$/u;
const NUMERIC_REFERENCE_IN_TEXT_PATTERN = /#\d{3,4}\b/gu;

const isNumericReference = (token: string): boolean =>
  NUMERIC_REFERENCE_PATTERN.test(token) && !REPEATED_DIGIT_PATTERN.test(token);

export const extractCardColors = (text: string, maxColors?: number): Color[] =>
  extractPaletteColors(
    text.replace(NUMERIC_REFERENCE_IN_TEXT_PATTERN, (match) =>
      isNumericReference(match) ? " " : match
    ),
    maxColors
  );

const isColorToken = (token: string): boolean => {
  if (isNumericReference(token)) {
    return false;
  }
  if (token.includes("(") && !FUNCTIONAL_COLOR_PATTERN.test(token)) {
    return false;
  }
  return parseColorString(token) !== null;
};

const countColorCodes = (text: string): number => {
  const hexes = new Set<string>();
  for (const match of text.matchAll(COLOR_CODE_PATTERN)) {
    if (isNumericReference(match[0])) {
      continue;
    }
    const color = parseColorString(match[0]);
    if (color) {
      hexes.add(color.hex.toUpperCase());
    }
  }
  return hexes.size;
};

const splitColorList = (content: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (
      char === ";" ||
      char === "\n" ||
      char === "\r" ||
      (char === "," && depth === 0)
    ) {
      parts.push(content.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(content.slice(start));
  return parts;
};

const isColorValue = (value: string): boolean => {
  const trimmed = value.trim().replace(/[.!]+$/u, "");
  if (!trimmed) {
    return false;
  }
  if (isColorToken(trimmed)) {
    return true;
  }
  const words = trimmed.split(COLOR_WORD_DELIMITER_PATTERN);
  let index = 0;
  while (index < words.length) {
    const longest = Math.min(MAX_COLOR_NAME_WORDS, words.length - index);
    let length = longest;
    for (; length > 0; length--) {
      const run = words.slice(index, index + length);
      const isNameRun =
        length === 1 || run.every((word) => PLAIN_WORD_PATTERN.test(word));
      if (isNameRun && isColorToken(run.join(""))) {
        break;
      }
    }
    if (length === 0) {
      return false;
    }
    index += length;
  }
  return true;
};

const isColorList = (content: unknown): content is string => {
  if (typeof content !== "string") {
    return false;
  }
  const parts = splitColorList(content)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    parts.length > 0 &&
    parts.every((part) => {
      if (isColorValue(part)) {
        return true;
      }
      const labelled = COLOR_LABEL_PATTERN.exec(part);
      return labelled ? isColorValue(labelled[1]) : false;
    })
  );
};

const colorListSwatches = (content: unknown): Color[] =>
  isColorList(content) ? extractCardColors(content) : [];

export const isProbablyPalette = (card: PaletteSource): boolean => {
  if (colorListSwatches(card.content).length > 0) {
    return true;
  }

  const text = buildPaletteAnalysisText(card);
  const codeCount = countColorCodes(text);
  if (codeCount >= 2) {
    return true;
  }
  if (!hasPaletteHint(card)) {
    return false;
  }
  return codeCount === 1 || extractCardColors(text).length > 0;
};

const fileNameFromUrl = (url?: string): string | undefined => {
  if (!url) {
    return;
  }
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).pop();
  } catch {
    return undefined;
  }
};

const classifyFile = (
  fileName: string | undefined,
  mimeType: string | undefined,
  confidence: number
): { type: CardType; confidence: number } | null => {
  const format = inferFileFormat({
    fileName: fileName || "file",
    mimeType,
  });
  return format ? { type: format.cardType, confidence } : null;
};

interface ClassifiableFileMetadata {
  duration?: number;
  fileName?: string;
  height?: number;
  mimeType?: string;
  width?: number;
}

const classifyByFileMetadata = (
  metadata: ClassifiableFileMetadata | undefined
): { type: CardType; confidence: number } | null => {
  if (!metadata) {
    return null;
  }

  const mimeClassification = classifyFile(
    metadata.fileName,
    metadata.mimeType,
    STRONG_CONFIDENCE
  );
  if (mimeClassification) {
    return mimeClassification;
  }

  if (typeof metadata.duration === "number" && metadata.duration > 0) {
    if (metadata.width || metadata.height) {
      return { type: "video", confidence: MEDIUM_CONFIDENCE };
    }
    return { type: "audio", confidence: MEDIUM_CONFIDENCE };
  }

  if (metadata.width || metadata.height) {
    return { type: "image", confidence: MEDIUM_CONFIDENCE };
  }

  return { type: "document", confidence: MEDIUM_CONFIDENCE };
};

export interface ClassifiableCard extends PaletteSource {
  fileKey?: string;
  fileMetadata?: ClassifiableFileMetadata;
  url?: string;
}

export const deterministicClassify = (
  card: ClassifiableCard
): { type: CardType; confidence: number } => {
  const fileMetaResult = classifyByFileMetadata(card.fileMetadata);
  if (fileMetaResult) {
    return fileMetaResult;
  }

  const extensionResult = classifyFile(
    fileNameFromUrl(card.url),
    undefined,
    MEDIUM_CONFIDENCE
  );
  if (extensionResult) {
    return extensionResult;
  }

  if (card.fileKey) {
    return { type: "document", confidence: MEDIUM_CONFIDENCE };
  }

  if (card.url) {
    return { type: "link", confidence: MEDIUM_CONFIDENCE };
  }

  if (isProbablyPalette(card)) {
    return { type: "palette", confidence: PALETTE_CONFIDENCE };
  }

  return { type: "text", confidence: DEFAULT_CONFIDENCE };
};

export const textCardRulesType = (card: { content?: string }): CardType =>
  normalizeQuoteContent(card.content ?? "").removedQuotes
    ? "quote"
    : deterministicClassify(card).type;
