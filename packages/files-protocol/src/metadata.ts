export const TEXT_METADATA_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8" as const;
export const MAX_AI_METADATA_INPUT_CHARS = 6000;
export const MAX_AI_METADATA_OUTPUT_TOKENS = 768;
export const MAX_AI_METADATA_VALIDATION_RETRIES = 2;
/**
 * The version of the AI tags and summary prompts (text, link and image).
 * Card processing records it beside the language it got, so a prompt change
 * can be measured. 2: tags and summary in the content's language.
 */
export const AI_METADATA_PROMPT_VERSION = 2;
/**
 * The language rules every AI tags and summary prompt shares. Hidden tags
 * stay English by design: only `secret` and `hidden` hide a card.
 */
const SHARED_LANGUAGE_RULES = `- In Japanese, Chinese and Korean, each tag is one term with no spaces, such as "デザイン", "设计" or "디자인".
- Never use "secret" or "hidden", or a translation of either, as a tag.`;
export const CONTENT_LANGUAGE_RULES = `- Write the tags and the summary in the same language as the content. If the content mixes languages, use the main one. If you can't tell the language, use English.
${SHARED_LANGUAGE_RULES}
- Language is the content's main language as a lowercase ISO 639-1 code, such as "en", "ja" or "es".`;
/** The image prompt's version of the rules: its language is the image's text. */
export const IMAGE_LANGUAGE_RULES = `- Write the tags and the summary in the language of the text in the image. If the text mixes languages, use the main one. If the image has no legible text, use English.
${SHARED_LANGUAGE_RULES}
- Language is the main language of the text in the image as a lowercase ISO 639-1 code, such as "en", "ja" or "es", and "en" when it has no legible text.`;
export const TEXT_ANALYSIS_SYSTEM_PROMPT = `You are an expert content analyzer. Generate relevant tags and a concise summary for the given content. /no_think

Guidelines:
- Tags should be 5-6 specific, relevant single words only (no spaces, no hyphens)
- Summary should be 1-2 sentences that capture the essence
- Focus on the main topics, themes, and key information
- Use clear, searchable language
${CONTENT_LANGUAGE_RULES}

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "...", "language": "xx"}`;
export const LINK_ANALYSIS_SYSTEM_PROMPT = `You are an expert web content analyzer. Generate relevant tags and a concise summary for the given web page content. /no_think

Guidelines:
- Tags should be 5-6 single words capturing main topics, categories, and key concepts (no spaces, no hyphens)
- Include relevant technology, industry, or topic tags where applicable
- Summary should be 1-2 sentences capturing the essence and value of the content
- Focus on what makes this link useful and searchable
- Use clear, specific language that helps with discovery
- Consider the source, author, and context when available
${CONTENT_LANGUAGE_RULES}

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "...", "language": "xx"}`;
export interface FilesAiGenerationFacts {
  usage?: { inputTokens?: number; outputTokens?: number };
  validationRetryCount: number;
}
export interface FilesTextMetadataResult {
  /** The content's main language (`normalizeAiLanguage`), when the model gave a valid one. */
  language?: string;
  summary: string;
  tags: string[];
}
export interface FilesTextMetadataOpResult
  extends FilesTextMetadataResult,
    FilesAiGenerationFacts {}
export const boundAiMetadataInput = (content: string): string => {
  if (content.length <= MAX_AI_METADATA_INPUT_CHARS) {
    return content;
  }
  const marker = `\n\n[Content truncated from ${content.length} characters]\n\n`;
  const retainedLength = MAX_AI_METADATA_INPUT_CHARS - marker.length;
  return `${content.slice(0, Math.ceil(retainedLength / 2))}${marker}${content.slice(-Math.floor(retainedLength / 2))}`;
};
export const validationRetryPrompt = (
  prompt: string,
  attempt: number
): string =>
  attempt === 0
    ? prompt
    : boundAiMetadataInput(
        `JSON validation retry ${attempt}: Return only the required JSON object with tags, summary and language. Do not include markdown, commentary, or any other keys.\n\n${prompt}`
      );
export const buildTextMetadataPrompt = (
  content: string,
  title?: string
): string =>
  boundAiMetadataInput(
    `Analyze this content and generate tags and summary:\n\n${title ? `Title: ${title}\n\nContent: ${content}` : content}`
  );
export const buildLinkMetadataPrompt = (
  content: string,
  url?: string
): string =>
  boundAiMetadataInput(`Analyze this web page content and generate optimized tags and summary for knowledge management:

${content}

${url ? `URL: ${url}` : ""}

Generate tags and summary that will help the user rediscover and understand the value of this content.`);
// ISO 639-1: the only two-letter language codes. A model often answers with
// a country code instead, which other countries' codes leave out.
const ISO_639_1 = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch " +
    "co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy " +
    "ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it " +
    "iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo " +
    "lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny " +
    "oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl " +
    "sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty " +
    "ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
  ).split(" ")
);
// Country codes models give for these languages. `kr` is also Kanuri, which
// a card is far less likely to be in than Korean.
const COUNTRY_CODES: Record<string, string> = { cn: "zh", jp: "ja", kr: "ko" };
const LANGUAGE_TAG = /^([a-z]{2,3})(?:-[a-z0-9]{1,8})*$/u;
// Not a language: undetermined, multiple, uncoded, no content, private use.
const NOT_A_LANGUAGE = /^(?:und|mul|mis|zxx|q[a-t][a-z])$/u;

const canonicalLanguage = (code: string): string => {
  try {
    // `jpn` → `ja`, `iw` → `he`: BCP 47 uses the shortest code.
    return (
      Intl.getCanonicalLocales(code)[0]?.toLowerCase().split("-")[0] ?? code
    );
  } catch {
    return code;
  }
};

/**
 * A model's `language` as a BCP 47 primary language subtag (`ja`, `es`,
 * `fil`), or undefined. Case, `_` and a region or script are tolerated
 * (`ZH`, `pt_BR`, `zh-Hans-CN`); anything else is dropped, never retried.
 */
export const normalizeAiLanguage = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 35) {
    return;
  }
  const primary = LANGUAGE_TAG.exec(
    value.trim().toLowerCase().replaceAll("_", "-")
  )?.[1];
  if (!primary) {
    return;
  }
  const code = COUNTRY_CODES[primary] ?? canonicalLanguage(primary);
  if (code.length === 2) {
    return ISO_639_1.has(code) ? code : undefined;
  }
  return /^[a-z]{3}$/u.test(code) && !NOT_A_LANGUAGE.test(code)
    ? code
    : undefined;
};

export const validateTextMetadata = (
  value: unknown
): FilesTextMetadataResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.tags) ||
    record.tags.some((tag) => typeof tag !== "string") ||
    typeof record.summary !== "string"
  ) {
    return null;
  }
  const language = normalizeAiLanguage(record.language);
  return {
    tags: record.tags as string[],
    summary: record.summary,
    ...(language ? { language } : {}),
  };
};
export const parseTextMetadata = (
  raw: string
): FilesTextMetadataResult | null => {
  try {
    return validateTextMetadata(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const readFilesAiGenerationFacts = (
  value: unknown
): FilesAiGenerationFacts | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const facts = value as Record<string, unknown>;
  if (
    typeof facts.validationRetryCount !== "number" ||
    !Number.isInteger(facts.validationRetryCount) ||
    facts.validationRetryCount < 0 ||
    facts.validationRetryCount > MAX_AI_METADATA_VALIDATION_RETRIES
  ) {
    return null;
  }
  const result: FilesAiGenerationFacts = {
    validationRetryCount: facts.validationRetryCount,
  };
  if (facts.usage !== undefined) {
    if (
      !facts.usage ||
      typeof facts.usage !== "object" ||
      Array.isArray(facts.usage)
    ) {
      return null;
    }
    const usage = facts.usage as Record<string, unknown>;
    result.usage = {};
    for (const field of ["inputTokens", "outputTokens"] as const) {
      const tokens = usage[field];
      if (tokens === undefined) {
        continue;
      }
      if (
        typeof tokens !== "number" ||
        !Number.isSafeInteger(tokens) ||
        tokens < 0
      ) {
        return null;
      }
      result.usage[field] = tokens;
    }
  }
  return result;
};

export const MAX_IMAGE_OCR_CHARS = 4000;
export interface FilesImageMetadataResult extends FilesTextMetadataResult {
  text?: string;
}

export interface FilesImageTextResult {
  text: string;
}

export const FILES_PDF_OCR_MAX_PAGES = 3;

export interface FilesPdfOcrResult {
  /** `null` when the renderer couldn't open the PDF. */
  pageCount: number | null;
  pagesRead: number;
  text: string;
}

const MIN_OCR_LETTERS_OR_DIGITS = 3;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const LINE_BREAKS = /\r\n?/gu;
const TRAILING_SPACE = /[^\S\n]+$/gmu;
const SPACE_RUNS = /(\S)[^\S\n]{2,}/gu;
const BLANK_LINE_RUNS = /\n{3,}/gu;

export const normalizeImageOcrText = (value: string): string | undefined => {
  const tidy = value
    .replace(LINE_BREAKS, "\n")
    .replace(CONTROL_CHARACTERS, (character) =>
      character === "\n" || character === "\t" ? character : ""
    )
    .replace(TRAILING_SPACE, "")
    .replace(SPACE_RUNS, "$1 ")
    .replace(BLANK_LINE_RUNS, "\n\n")
    .trim();
  const text = Array.from(tidy)
    .slice(0, MAX_IMAGE_OCR_CHARS)
    .join("")
    .trimEnd();
  return (text.match(LETTER_OR_DIGIT)?.length ?? 0) >= MIN_OCR_LETTERS_OR_DIGITS
    ? text
    : undefined;
};
