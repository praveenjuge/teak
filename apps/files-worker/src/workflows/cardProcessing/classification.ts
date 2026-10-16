import { internal } from "@teak/convex/_generated/api";
import { normalizeQuoteContent } from "@teak/convex/card/quoteFormatting";
import type { CardType } from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import {
  type Color,
  extractPaletteColors,
  MAX_COLOR_NAME_WORDS,
  parseColorString,
} from "@teak/convex/shared/utils/colorUtils";
import {
  type CardDoc,
  type CardJob,
  guardOf,
  loadCard,
  markInProgress,
} from "./context";

// Classification: the card's type from its file, URL and text, without AI.

interface PaletteSource {
  content?: unknown;
  notes?: unknown;
  tags?: unknown;
}

const MAX_PALETTE_COLORS = 12;

const STRONG_CONFIDENCE = 0.97;
const MEDIUM_CONFIDENCE = 0.9;
const PALETTE_CONFIDENCE = 0.88;
const DEFAULT_CONFIDENCE = 0.7;

export interface CompletedClassification {
  confidence: number;
  mode: "completed";
  needsLinkMetadata: boolean;
  shouldCategorize: boolean;
  shouldGenerateMetadata: boolean;
  shouldGenerateRenderables: boolean;
  type: CardType;
}

export type ClassificationResult =
  | CompletedClassification
  | { mode: "skipped" };

interface DbColor {
  hex: string;
  hsl?: { h: number; s: number; l: number };
  name?: string;
  rgb?: { r: number; g: number; b: number };
}

const toDbColor = (color: Color): DbColor => ({
  hex: color.hex.toUpperCase(),
  ...(color.name ? { name: color.name } : {}),
  ...(color.rgb ? { rgb: color.rgb } : {}),
  ...(color.hsl ? { hsl: color.hsl } : {}),
});

const colorsMatch = (
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

const buildPaletteAnalysisText = (card: PaletteSource): string => {
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

// Function arguments are bounded so unclosed "rgb(" text cannot make the
// scan quadratic.
const COLOR_CODE_PATTERN =
  /#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})\b|rgba?\([^()]{0,64}\)|hsla?\([^()]{0,64}\)/gi;
// "Primary: #0F4C81", "--bg-primary: #FF5733" or "Accent - rgb(…)". A dash
// separates only when spaced, so hyphenated labels stay whole.
const COLOR_LABEL_PATTERN =
  /^(?:--[\w-]+\s*[:=]\s*|[a-z][\w\s-]{0,32}?(?:\s*[:=]\s*|\s+[-–]\s+))(.+)$/iu;
const COLOR_WORD_DELIMITER_PATTERN = /\s+/;
const PLAIN_WORD_PATTERN = /^[a-z]+$/iu;
const FUNCTIONAL_COLOR_PATTERN = /^(?:rgba?|hsla?)\([^()]{0,64}\)$/iu;
const NUMERIC_REFERENCE_PATTERN = /^#\d{3,4}$/u;
const REPEATED_DIGIT_PATTERN = /^#(\d)\1+$/u;
const NUMERIC_REFERENCE_IN_TEXT_PATTERN = /#\d{3,4}\b/gu;

// "#123" or "#1234" in a note is far more often an issue or ticket number
// than a colour. Repeated digits ("#000", "#333") stay colours.
const isNumericReference = (token: string): boolean =>
  NUMERIC_REFERENCE_PATTERN.test(token) && !REPEATED_DIGIT_PATTERN.test(token);

// parseColorString finds rgb()/hsl() anywhere in a string, so a token with
// parentheses must be exactly one functional colour.
// extractPaletteColors reads "#123" as #112233, so drop references before
// extracting swatches.
const extractCardColors = (text: string, maxColors?: number): Color[] =>
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

// Splits on commas, semicolons and line breaks in one pass. Commas inside
// rgb()/hsl() belong to the value, not the list.
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
  // "red green blue" or "light blue red" lists several colours separated by
  // spaces. Read multi-word names first, as colour extraction does.
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

// True when the content is nothing but colours, optionally labelled
// ("Primary: #0F4C81"). Prose that only mentions a colour word, such as
// "dark green cabinets", is not a colour list.
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

export const isProbablyPalette = (card: PaletteSource): boolean => {
  // A list such as "mint cream" parses as a colour name but yields no
  // swatches, so a colour list must also produce at least one colour.
  if (isColorList(card.content) && extractCardColors(card.content).length > 0) {
    return true;
  }

  // Colour names in prose are ordinary words, so outside a colour list only
  // explicit colour codes (hex, rgb, hsl) count, unless the card says it is
  // a palette.
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
  } catch {}
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

const classifyByFileMetadata = (
  metadata: CardDoc["fileMetadata"]
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

export const deterministicClassify = (
  card: CardDoc
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

const maybeUpdatePaletteColors = async (
  job: CardJob,
  card: CardDoc,
  normalizedType: CardType
) => {
  if (normalizedType !== "palette") {
    return;
  }
  const colors = extractCardColors(
    buildPaletteAnalysisText(card),
    MAX_PALETTE_COLORS
  );
  if (colors.length === 0) {
    return;
  }
  const dbColors = colors.map(toDbColor);
  if (!colorsMatch(card.colors, dbColors)) {
    await job.deps.convex.mutation(
      internal.workflows.aiMetadata.mutations.updateCardColors,
      { cardId: job.cardId, colors: dbColors },
      guardOf(job)
    );
  }
};

const recordClassification = (
  job: CardJob,
  args: { confidence: number; type?: CardType }
) =>
  job.deps.convex.mutation(
    internal.workflows.steps.classificationMutations.recordClassification,
    { cardId: job.cardId, ...args },
    guardOf(job)
  );

const completed = (
  type: CardType,
  confidence: number,
  needsLinkMetadata = false
): CompletedClassification => ({
  confidence,
  mode: "completed",
  needsLinkMetadata,
  shouldCategorize: type === "link",
  shouldGenerateMetadata: true,
  shouldGenerateRenderables: ["image", "video", "document"].includes(type),
  type,
});

/**
 * Classifies a card and records the result. Every exit records the classify
 * stage, because steps gated on it (link metadata) wait while it is pending.
 */
export const classifyCard = async (
  job: CardJob
): Promise<ClassificationResult> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return { mode: "skipped" };
  }
  await markInProgress(job, ["classify"]);
  const { card } = loaded;

  if (card.type === "quote" && !card.url && !card.fileKey) {
    const confidence = card.processingStatus?.classify?.confidence ?? 0.95;
    await recordClassification(job, { confidence });
    return completed("quote", confidence);
  }

  const quoteNormalization = normalizeQuoteContent(card.content ?? "");
  if (quoteNormalization.removedQuotes && !card.url && !card.fileKey) {
    await recordClassification(job, { confidence: 0.95, type: "quote" });
    return completed("quote", 0.95);
  }

  const { type: resultType, confidence: resultConfidence } =
    deterministicClassify(card);

  const trimmedContent =
    typeof card.content === "string" ? card.content.trim() : "";
  const urlOnlyCard =
    !!card.url &&
    !card.fileKey &&
    (trimmedContent.length === 0 || trimmedContent === card.url);

  const normalizedType: CardType =
    urlOnlyCard && resultType !== "link" ? "link" : resultType;
  const normalizedConfidence = Math.max(0, Math.min(resultConfidence, 1));

  const shouldForceLink = urlOnlyCard && card.type !== "link";
  const shouldUpdateType =
    shouldForceLink ||
    (normalizedType !== card.type && normalizedConfidence >= 0.6);

  if (shouldUpdateType) {
    await recordClassification(job, {
      confidence: normalizedConfidence,
      type: normalizedType,
    });
    await maybeUpdatePaletteColors(job, card, normalizedType);
  } else {
    // The stage was marked in progress, so it is always recorded.
    await recordClassification(job, { confidence: normalizedConfidence });
  }

  return completed(
    normalizedType,
    normalizedConfidence,
    normalizedType === "link" &&
      card.metadata?.linkPreview?.status !== "success"
  );
};
