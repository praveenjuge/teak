/** Canonical text/link metadata policy shared by Convex and Files Worker. */
export const TEXT_METADATA_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8" as const;
export const LINK_METADATA_MODEL_ID = TEXT_METADATA_MODEL_ID;
export const MAX_AI_METADATA_INPUT_CHARS = 6000;
export const MAX_AI_METADATA_OUTPUT_TOKENS = 768;
export const MAX_AI_METADATA_VALIDATION_RETRIES = 2;
export const TEXT_ANALYSIS_SYSTEM_PROMPT = `You are an expert content analyzer. Generate relevant tags and a concise summary for the given content. /no_think

Guidelines:
- Tags should be 5-6 specific, relevant single words only (no spaces, no hyphens)
- Summary should be 1-2 sentences that capture the essence
- Focus on the main topics, themes, and key information
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`;
export const LINK_ANALYSIS_SYSTEM_PROMPT = `You are an expert web content analyzer. Generate relevant tags and a concise summary for the given web page content. /no_think

Guidelines:
- Tags should be 5-6 single words capturing main topics, categories, and key concepts (no spaces, no hyphens)
- Include relevant technology, industry, or topic tags where applicable
- Summary should be 1-2 sentences capturing the essence and value of the content
- Focus on what makes this link useful and searchable
- Use clear, specific language that helps with discovery
- Consider the source, author, and context when available

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`;
export interface FilesAiGenerationFacts {
  usage?: { inputTokens?: number; outputTokens?: number };
  validationRetryCount: number;
}
export interface FilesTextMetadataResult {
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
        `JSON validation retry ${attempt}: Return only the required JSON object with tags and summary. Do not include markdown, commentary, or any other keys.\n\n${prompt}`
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
/** Same output contract as the existing Zod object: strip unknown fields. */
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
  return { tags: record.tags as string[], summary: record.summary };
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

/** Only bounded numeric diagnostics may cross the private operation boundary. */
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
