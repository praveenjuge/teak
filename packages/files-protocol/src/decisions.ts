/**
 * Clef decision models on Workers AI, shared by Convex and the Files Worker.
 *
 * Clef reads a state and up to 64 typed questions and returns a probability
 * for every allowed answer, never free text. The Files Worker owns the
 * prompts, the model calls and the thresholds; Convex sends the inputs it
 * already has and stores the decision, or keeps its rules' answer when the
 * decision is `null`.
 */
export const CLEF_MODEL_ID = "@cf/cloudflare/clef" as const;
export const CLEF_FLASH_MODEL_ID = "@cf/cloudflare/clef-flash" as const;

export type ClefModel = "clef" | "clef-flash";

export const CLEF_MODEL_IDS: Record<ClefModel, string> = {
  clef: CLEF_MODEL_ID,
  "clef-flash": CLEF_FLASH_MODEL_ID,
};

/** Clef bills no output tokens. */
export const CLEF_INPUT_USD_PER_MILLION: Record<string, number> = {
  [CLEF_MODEL_ID]: 0.24,
  [CLEF_FLASH_MODEL_ID]: 0.038,
};

/** Clef accepts 1 to 64 questions per request. */
export const MAX_DECISION_QUESTIONS = 64;

export const DECISION_VERSIONS = {
  cardType: 2,
  linkCategory: 2,
  relevance: 1,
  visualStyles: 1,
} as const;

export const DECISION_THRESHOLDS = {
  cardType: 0.75,
  linkCategory: 0.95,
  visualStyle: 0.7,
} as const;

export const MAX_VISUAL_STYLES_PER_CARD = 4;

export const DECISION_TEXT_LIMITS = {
  cardTypeContent: 4000,
  linkDescription: 1000,
  linkTitle: 500,
  linkUrl: 2000,
  linkJsonLdTypes: 8,
  relevanceCardText: 600,
  relevanceQuery: 500,
} as const;

export const RELEVANCE_LEVELS = [
  "Not related",
  "Loosely related",
  "Relevant",
  "Exactly what they are looking for",
] as const;

export const RELEVANCE_MAX_SCORE = RELEVANCE_LEVELS.length - 1;

export const CARD_TYPE_DECISION_TYPES = ["text", "quote", "palette"] as const;
export type CardTypeDecisionType = (typeof CARD_TYPE_DECISION_TYPES)[number];

export interface FilesDecisionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface FilesDecisionFacts {
  model: string;
  usage?: FilesDecisionUsage;
  version: number;
}

export interface FilesLinkCategoryDecisionParams {
  description?: string;
  jsonLdTypes?: string[];
  rulesCategory: string;
  siteName?: string;
  title?: string;
  url: string;
}

export interface FilesLinkCategoryDecisionResult extends FilesDecisionFacts {
  /** `null` keeps the rules' answer. */
  decision: { category: string; confidence: number } | null;
}

export interface FilesCardTypeDecisionParams {
  content: string;
  rulesType: CardTypeDecisionType;
}

export interface FilesCardTypeDecisionResult extends FilesDecisionFacts {
  /** `null` keeps the rules' answer. */
  decision: { confidence: number; type: CardTypeDecisionType } | null;
}

export interface FilesVisualStylesDecisionParams {
  sourceKey: string;
  title?: string;
}

export interface FilesVisualStylesDecisionResult extends FilesDecisionFacts {
  /** Most likely first, at most `MAX_VISUAL_STYLES_PER_CARD`. */
  styles: string[];
}

export interface FilesRelevanceCard {
  id: string;
  text: string;
}

export interface FilesRelevanceParams {
  cards: FilesRelevanceCard[];
  query: string;
}

export interface FilesRelevanceResult extends FilesDecisionFacts {
  /** One score per card, 0 to `RELEVANCE_MAX_SCORE`. */
  scores: Array<{ id: string; score: number }>;
}

const isFiniteProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const readUsage = (value: unknown): FilesDecisionUsage | undefined | null => {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  ) {
    return null;
  }
  return { inputTokens, outputTokens };
};

const readFacts = (value: unknown): FilesDecisionFacts | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const usage = readUsage(record.usage);
  if (
    typeof record.model !== "string" ||
    typeof record.version !== "number" ||
    usage === null
  ) {
    return null;
  }
  return {
    model: record.model,
    version: record.version,
    ...(usage ? { usage } : {}),
  };
};

export const readLinkCategoryDecision = (
  value: unknown,
  isCategory: (category: string) => boolean
): FilesLinkCategoryDecisionResult | null => {
  const facts = readFacts(value);
  if (!facts) {
    return null;
  }
  const decision = (value as { decision?: unknown }).decision;
  if (decision === null) {
    return { ...facts, decision: null };
  }
  if (!decision || typeof decision !== "object") {
    return null;
  }
  const { category, confidence } = decision as Record<string, unknown>;
  if (
    typeof category !== "string" ||
    !isCategory(category) ||
    !isFiniteProbability(confidence)
  ) {
    return null;
  }
  return { ...facts, decision: { category, confidence } };
};

export const readCardTypeDecision = (
  value: unknown
): FilesCardTypeDecisionResult | null => {
  const facts = readFacts(value);
  if (!facts) {
    return null;
  }
  const decision = (value as { decision?: unknown }).decision;
  if (decision === null) {
    return { ...facts, decision: null };
  }
  if (!decision || typeof decision !== "object") {
    return null;
  }
  const { confidence, type } = decision as Record<string, unknown>;
  if (
    typeof type !== "string" ||
    !(CARD_TYPE_DECISION_TYPES as readonly string[]).includes(type) ||
    !isFiniteProbability(confidence)
  ) {
    return null;
  }
  return {
    ...facts,
    decision: { confidence, type: type as CardTypeDecisionType },
  };
};

export const readVisualStylesDecision = (
  value: unknown,
  isStyle: (style: string) => boolean
): FilesVisualStylesDecisionResult | null => {
  const facts = readFacts(value);
  if (!facts) {
    return null;
  }
  const styles = (value as { styles?: unknown }).styles;
  if (
    !Array.isArray(styles) ||
    styles.length > MAX_VISUAL_STYLES_PER_CARD ||
    styles.some((style) => typeof style !== "string" || !isStyle(style)) ||
    new Set(styles).size !== styles.length
  ) {
    return null;
  }
  return { ...facts, styles: styles as string[] };
};

export const readRelevanceResult = (
  value: unknown,
  cardIds: readonly string[]
): FilesRelevanceResult | null => {
  const facts = readFacts(value);
  if (!facts) {
    return null;
  }
  const scores = (value as { scores?: unknown }).scores;
  if (!Array.isArray(scores)) {
    return null;
  }
  const expected = new Set(cardIds);
  const seen = new Set<string>();
  const read: Array<{ id: string; score: number }> = [];
  for (const entry of scores) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const { id, score } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !expected.has(id) ||
      seen.has(id) ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > RELEVANCE_MAX_SCORE
    ) {
      return null;
    }
    seen.add(id);
    read.push({ id, score });
  }
  return seen.size === expected.size ? { ...facts, scores: read } : null;
};
