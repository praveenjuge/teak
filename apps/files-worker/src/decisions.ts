import {
  VISUAL_STYLE_TAXONOMY,
  type VisualStyle,
} from "@teak/convex/shared/constants";
import {
  LINK_CATEGORIES,
  type LinkCategory,
} from "@teak/convex/shared/linkCategories";
import {
  CARD_TYPE_DECISION_TYPES,
  type CardTypeDecisionType,
  CLEF_MODEL_IDS,
  type ClefModel,
  DECISION_TEXT_LIMITS,
  DECISION_THRESHOLDS,
  DECISION_VERSIONS,
  type FilesCardTypeDecisionResult,
  type FilesDecisionUsage,
  type FilesLinkCategoryDecisionResult,
  type FilesRelevanceResult,
  type FilesVisualStylesDecisionResult,
  MAX_DECISION_QUESTIONS,
  MAX_VISUAL_STYLES_PER_CARD,
  RELEVANCE_LEVELS,
  RELEVANCE_MAX_SCORE,
} from "@teak/files-protocol";
import { aiRunOptions } from "./aiGateway";
import { loadImageForAi } from "./imageMetadata";
import type { Env } from "./index";
import type { FilesOpsEnv } from "./ops";
import { isCapacityError, MetadataCapacityError } from "./textMetadata";

/**
 * Clef rejects images over 4 MiB. A larger rendition is no decision, so
 * callers fall back to the tag aliases.
 */
const MAX_CLEF_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CLEF_CAPACITY_RETRIES = 2;
const CAPACITY_RETRY_BASE_DELAY_MS = 250;

/**
 * One line per category, used as Clef's choice criteria. `Record` keeps it
 * exhaustive: a new category fails the typecheck until it is described here.
 */
export const LINK_CATEGORY_DESCRIPTIONS: Record<LinkCategory, string> = {
  other: "None of the kinds below, or a general website or home page",
  book: "A page about one specific book or ebook",
  movie: "A page about one specific film",
  tv: "A page about one specific TV show, series or episode",
  article: "A long-form article, essay, guide or opinion piece",
  news: "A news report or short blog update about a recent event",
  podcast: "A podcast or one podcast episode",
  music: "A song, album, artist or playlist",
  product: "A product someone can buy, or a shopping page for one",
  recipe: "A recipe with ingredients and steps for a dish or drink",
  course: "An online course, class, tutorial series or lesson",
  research: "A research paper, preprint, study or academic publication",
  event: "A specific event, conference, meetup or ticketed show",
  software: "A software tool, library, developer tool or online service",
  design_portfolio:
    "A designer's or studio's portfolio, case study or design showcase",
  place:
    "A physical place: a restaurant, shop, venue, hotel, attraction or property listing",
  typeface: "A typeface or font family",
  social_post:
    "A single post on a social network, such as a tweet, toot or Reddit post",
  app: "A mobile or desktop app's store listing or download page",
  game: "A video game or board game",
  repo: "A code repository on GitHub, GitLab or a similar host",
};

/** Each style as a yes/no question about the image. */
export const VISUAL_STYLE_DESCRIPTIONS: Record<VisualStyle, string> = {
  abstract: "abstract, without a recognisable real subject",
  cinematic: "cinematic, like a still from a film",
  dark: "dark, with mostly deep shadows and low light",
  illustrative: "an illustration, drawing or cartoon rather than a photo",
  minimal: "minimal, with few elements and plenty of empty space",
  monochrome: "monochrome, black and white or a single hue",
  moody: "moody, dramatic or atmospheric",
  pastel: "in soft pastel colours",
  photographic: "a photograph of a real scene",
  retro: "retro, imitating a past decade's look such as the 80s",
  surreal: "surreal or dreamlike",
  vintage: "vintage, aged or antique-looking",
  vibrant: "vibrant, with bold saturated colours",
  typographic: "typographic, where lettering or type is the main element",
  "3d": "a 3D render, CGI or isometric scene",
  flat: "flat design, with flat vector shapes and no depth",
  geometric: "geometric, built from clear shapes and patterns",
  "hand-drawn": "hand-drawn, such as a sketch, doodle or line art",
  futuristic: "futuristic, sci-fi or cyberpunk",
};

const CARD_TYPE_CRITERIA: Record<CardTypeDecisionType, string> = {
  text: "Notes, lists, prose, code or anything else the person wrote",
  quote: "A quotation of someone else's words, usually with who said it",
  palette: "A set of colours meant to be kept together as a palette",
};

export type ClefQuestion =
  | {
      type: "noul";
      instructions: unknown;
      criteria?: { false?: unknown; true?: unknown };
    }
  | {
      type: "choice";
      instructions: unknown;
      criteria: Record<string, unknown>;
    }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export interface ClefRequest {
  images?: string[];
  model: ClefModel;
  questions: Record<string, ClefQuestion>;
  state: unknown;
}

export type ClefAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | {
      type: "score";
      score: number;
      confidence: number;
      probabilities: Record<string, number>;
    };

export interface ClefReply {
  answers: Record<string, ClefAnswer>;
  usage?: FilesDecisionUsage;
}

const isProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isProbabilityMap = (value: unknown): value is Record<string, number> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every(isProbability);

/**
 * Checks one answer against the question it answers. Any mismatch fails the
 * whole reply: a partial decision is never used.
 */
const readAnswer = (
  question: ClefQuestion,
  value: unknown
): ClefAnswer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const answer = value as Record<string, unknown>;
  if (answer.type !== question.type) {
    return null;
  }
  if (question.type === "noul") {
    return isProbability(answer.noul)
      ? { type: "noul", noul: answer.noul }
      : null;
  }
  if (
    !(
      isProbability(answer.confidence) && isProbabilityMap(answer.probabilities)
    )
  ) {
    return null;
  }
  if (question.type === "choice") {
    if (
      typeof answer.choice !== "string" ||
      !Object.hasOwn(question.criteria, answer.choice)
    ) {
      return null;
    }
    return {
      type: "choice",
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    };
  }
  if (
    typeof answer.score !== "number" ||
    !Number.isFinite(answer.score) ||
    answer.score < 0 ||
    answer.score > question.criteria.length - 1
  ) {
    return null;
  }
  return {
    type: "score",
    score: answer.score,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
  };
};

export const parseClefReply = (
  request: ClefRequest,
  response: unknown
): ClefReply => {
  if (!response || typeof response !== "object") {
    throw new Error("malformed_clef_response");
  }
  const reply = response as { answers?: unknown; usage?: unknown };
  if (!reply.answers || typeof reply.answers !== "object") {
    throw new Error("malformed_clef_response");
  }
  const raw = reply.answers as Record<string, unknown>;
  const answers: Record<string, ClefAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = readAnswer(question, raw[id]);
    if (!answer) {
      throw new Error("invalid_clef_answer");
    }
    answers[id] = answer;
  }
  const usage = reply.usage as
    | { input_tokens?: unknown; output_tokens?: unknown }
    | undefined;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  return {
    answers,
    ...(typeof inputTokens === "number" &&
    Number.isSafeInteger(inputTokens) &&
    inputTokens >= 0 &&
    typeof outputTokens === "number" &&
    Number.isSafeInteger(outputTokens) &&
    outputTokens >= 0
      ? { usage: { inputTokens, outputTokens } }
      : {}),
  };
};

const waitForCapacityRetry = (attempt: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, CAPACITY_RETRY_BASE_DELAY_MS * 2 ** attempt);
  });

/** One Clef call, with the same capacity retries as the metadata models. */
export const runClef = async (
  env: FilesOpsEnv,
  request: ClefRequest
): Promise<ClefReply> => {
  const questionCount = Object.keys(request.questions).length;
  if (questionCount === 0 || questionCount > MAX_DECISION_QUESTIONS) {
    throw new Error("invalid_clef_question_count");
  }
  if (!env.AI) {
    throw new Error("workers_ai_not_configured");
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await env.AI.run(
        CLEF_MODEL_IDS[request.model],
        { ...request },
        aiRunOptions(env)
      );
      return parseClefReply(request, response);
    } catch (error) {
      if (!isCapacityError(error)) {
        throw error;
      }
      if (attempt >= MAX_CLEF_CAPACITY_RETRIES) {
        throw new MetadataCapacityError({ validationRetryCount: 0 });
      }
      await waitForCapacityRetry(attempt);
    }
  }
};

const facts = (
  model: ClefModel,
  version: number,
  usage: FilesDecisionUsage | undefined
) => ({
  model: CLEF_MODEL_IDS[model],
  version,
  ...(usage ? { usage } : {}),
});

const clip = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
};

const optionalText = (
  params: Record<string, unknown>,
  name: string
): string | undefined => {
  const value = params[name];
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "string") {
    throw new Error(`invalid_${name}`);
  }
  return value;
};

const isLinkCategory = (value: unknown): value is LinkCategory =>
  typeof value === "string" &&
  (LINK_CATEGORIES as readonly string[]).includes(value);

/** The Clef request for a link's category; also used by scripts/clef-eval. */
export const buildLinkCategoryRequest = (
  params: Record<string, unknown>
): { request: ClefRequest; rulesCategory: LinkCategory } => {
  const url = params.url;
  const rulesCategory = params.rulesCategory;
  if (
    typeof url !== "string" ||
    !url ||
    url.length > DECISION_TEXT_LIMITS.linkUrl
  ) {
    throw new Error("invalid_url");
  }
  if (!isLinkCategory(rulesCategory)) {
    throw new Error("invalid_rules_category");
  }
  const jsonLdTypes = params.jsonLdTypes;
  if (
    jsonLdTypes !== undefined &&
    !(
      Array.isArray(jsonLdTypes) &&
      jsonLdTypes.every((type) => typeof type === "string")
    )
  ) {
    throw new Error("invalid_json_ld_types");
  }
  let host: string | undefined;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("invalid_url");
  }

  const state = {
    url,
    site:
      clip(optionalText(params, "siteName"), DECISION_TEXT_LIMITS.linkTitle) ??
      host,
    title: clip(optionalText(params, "title"), DECISION_TEXT_LIMITS.linkTitle),
    description: clip(
      optionalText(params, "description"),
      DECISION_TEXT_LIMITS.linkDescription
    ),
    structuredDataTypes: [
      ...new Set((jsonLdTypes as string[] | undefined) ?? []),
    ].slice(0, DECISION_TEXT_LIMITS.linkJsonLdTypes),
  };
  return {
    rulesCategory,
    request: {
      model: "clef",
      state,
      questions: {
        category: {
          type: "choice",
          instructions:
            "What kind of page is this saved link? Pick the closest kind.",
          criteria: LINK_CATEGORY_DESCRIPTIONS,
        },
      },
    },
  };
};

/**
 * Link category for a link the resolver had no domain or path rule for.
 * Clef 27B, because `other` must stay a real answer among 15. It never
 * decides `other` and never repeats the rules' answer, so `null` means keep
 * the rules.
 */
export const decideLinkCategory = async (
  env: FilesOpsEnv,
  params: Record<string, unknown>
): Promise<FilesLinkCategoryDecisionResult> => {
  const { request, rulesCategory } = buildLinkCategoryRequest(params);
  const { model } = request;
  const reply = await runClef(env, request);
  const answer = reply.answers.category;
  const base = facts(model, DECISION_VERSIONS.linkCategory, reply.usage);
  if (answer?.type !== "choice") {
    return { ...base, decision: null };
  }
  const probability = answer.probabilities[answer.choice] ?? 0;
  const changes =
    isLinkCategory(answer.choice) &&
    answer.choice !== "other" &&
    answer.choice !== rulesCategory &&
    probability >= DECISION_THRESHOLDS.linkCategory;
  return {
    ...base,
    decision: changes
      ? { category: answer.choice, confidence: probability }
      : null,
  };
};

const isCardTypeDecisionType = (
  value: unknown
): value is CardTypeDecisionType =>
  typeof value === "string" &&
  (CARD_TYPE_DECISION_TYPES as readonly string[]).includes(value);

/** The Clef request for a note's type; also used by scripts/clef-eval. */
export const buildCardTypeRequest = (
  params: Record<string, unknown>
): { request: ClefRequest; rulesType: CardTypeDecisionType } => {
  const content = params.content;
  const rulesType = params.rulesType;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("invalid_content");
  }
  if (!isCardTypeDecisionType(rulesType)) {
    throw new Error("invalid_rules_type");
  }
  return {
    rulesType,
    request: {
      model: "clef-flash",
      state: content.slice(0, DECISION_TEXT_LIMITS.cardTypeContent),
      questions: {
        type: {
          type: "choice",
          instructions: "What did the person save in this note?",
          criteria: CARD_TYPE_CRITERIA,
        },
      },
    },
  };
};

/**
 * Text, quote or palette for a card with no URL or file. Text is listed first
 * so a tie keeps the card as the person wrote it.
 */
export const decideCardType = async (
  env: FilesOpsEnv,
  params: Record<string, unknown>
): Promise<FilesCardTypeDecisionResult> => {
  const { request, rulesType } = buildCardTypeRequest(params);
  const { model } = request;
  const reply = await runClef(env, request);
  const answer = reply.answers.type;
  const base = facts(model, DECISION_VERSIONS.cardType, reply.usage);
  if (answer?.type !== "choice" || !isCardTypeDecisionType(answer.choice)) {
    return { ...base, decision: null };
  }
  const probability = answer.probabilities[answer.choice] ?? 0;
  return {
    ...base,
    decision:
      answer.choice !== rulesType && probability >= DECISION_THRESHOLDS.cardType
        ? { type: answer.choice, confidence: probability }
        : null,
  };
};

export const VISUAL_STYLE_QUESTION_PREFIX = "style.";

/** The Clef request for an image's styles; also used by scripts/clef-eval. */
export const buildVisualStylesRequest = (
  dataUrl: string,
  title?: string | null
): ClefRequest => {
  const questions: Record<string, ClefQuestion> = {};
  for (const style of VISUAL_STYLE_TAXONOMY) {
    questions[`${VISUAL_STYLE_QUESTION_PREFIX}${style}`] = {
      type: "noul",
      instructions: `Is this image ${VISUAL_STYLE_DESCRIPTIONS[style]}?`,
    };
  }
  return {
    model: "clef-flash",
    images: [dataUrl],
    state: title
      ? { title: title.slice(0, DECISION_TEXT_LIMITS.linkTitle) }
      : "",
    questions,
  };
};

/**
 * Up to 4 styles for an image, most likely first. Each style is its own
 * yes/no question, so adding a style never changes another's answer.
 */
export const decideVisualStylesForImage = async (
  env: FilesOpsEnv,
  image: { bytes: Uint8Array; dataUrl: string },
  title?: string | null
): Promise<FilesVisualStylesDecisionResult> => {
  const model: ClefModel = "clef-flash";
  if (image.bytes.byteLength > MAX_CLEF_IMAGE_BYTES) {
    throw new Error("clef_image_too_large");
  }
  const reply = await runClef(
    env,
    buildVisualStylesRequest(image.dataUrl, title)
  );
  const styles = VISUAL_STYLE_TAXONOMY.flatMap((style) => {
    const answer = reply.answers[`${VISUAL_STYLE_QUESTION_PREFIX}${style}`];
    return answer?.type === "noul" &&
      answer.noul >= DECISION_THRESHOLDS.visualStyle
      ? [{ probability: answer.noul, style }]
      : [];
  })
    .sort((left, right) => right.probability - left.probability)
    .slice(0, MAX_VISUAL_STYLES_PER_CARD)
    .map(({ style }) => style);
  return {
    ...facts(model, DECISION_VERSIONS.visualStyles, reply.usage),
    styles,
  };
};

export const decideVisualStyles = async (
  env: Env,
  {
    origin,
    sourceKey,
    title,
  }: { origin: string; sourceKey: string; title?: string | null }
): Promise<FilesVisualStylesDecisionResult> =>
  decideVisualStylesForImage(
    env,
    await loadImageForAi(env, origin, sourceKey),
    title
  );

/**
 * The Clef request for Best match scores, one question per card in order;
 * also used by scripts/clef-eval.
 */
export const buildRelevanceRequest = (
  params: Record<string, unknown>
): { cardIds: string[]; request: ClefRequest } => {
  const query = params.query;
  const cards = params.cards;
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > DECISION_TEXT_LIMITS.relevanceQuery
  ) {
    throw new Error("invalid_query");
  }
  if (
    !Array.isArray(cards) ||
    cards.length === 0 ||
    cards.length > MAX_DECISION_QUESTIONS
  ) {
    throw new Error("invalid_cards");
  }
  const ids = new Set<string>();
  const questions: Record<string, ClefQuestion> = {};
  cards.forEach((card, index) => {
    if (
      !card ||
      typeof card !== "object" ||
      typeof (card as { id?: unknown }).id !== "string" ||
      typeof (card as { text?: unknown }).text !== "string"
    ) {
      throw new Error("invalid_cards");
    }
    const { id, text } = card as { id: string; text: string };
    if (ids.has(id)) {
      throw new Error("invalid_cards");
    }
    ids.add(id);
    questions[`card.${index}`] = {
      type: "score",
      instructions: {
        question:
          "How well does this saved card match what the person is searching for?",
        card: text.slice(0, DECISION_TEXT_LIMITS.relevanceCardText),
      },
      criteria: [...RELEVANCE_LEVELS],
    };
  });
  return {
    cardIds: [...ids],
    request: {
      model: "clef-flash",
      state: { search: query.trim() },
      questions,
    },
  };
};

/**
 * Best match scores. The state is the search; each card is one score
 * question, evaluated on its own, so a card's score never depends on which
 * other cards share the request.
 */
export const scoreRelevance = async (
  env: FilesOpsEnv,
  params: Record<string, unknown>
): Promise<FilesRelevanceResult> => {
  const { cardIds, request } = buildRelevanceRequest(params);
  const { model } = request;
  const reply = await runClef(env, request);
  const scores = cardIds.map((id, index) => {
    const answer = reply.answers[`card.${index}`];
    const score = answer?.type === "score" ? answer.score : 0;
    return {
      id,
      score: Math.min(Math.max(score, 0), RELEVANCE_MAX_SCORE),
    };
  });
  return {
    ...facts(model, DECISION_VERSIONS.relevance, reply.usage),
    scores,
  };
};
