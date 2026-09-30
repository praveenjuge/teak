import {
  type FilesAiGenerationFacts,
  type FilesTextMetadataOpResult,
  LINK_ANALYSIS_SYSTEM_PROMPT,
  MAX_AI_METADATA_INPUT_CHARS,
  MAX_AI_METADATA_OUTPUT_TOKENS,
  MAX_AI_METADATA_VALIDATION_RETRIES,
  parseTextMetadata,
  TEXT_ANALYSIS_SYSTEM_PROMPT,
  TEXT_METADATA_MODEL_ID,
  validationRetryPrompt,
} from "@teak/files-protocol";
import type { FilesOpsEnv } from "./ops";

export class MetadataCapacityError extends Error {
  readonly aiFacts: FilesAiGenerationFacts;
  constructor(aiFacts: FilesAiGenerationFacts) {
    super("workers_ai_capacity_exhausted");
    this.aiFacts = aiFacts;
  }
}
export class MetadataValidationError extends Error {
  readonly aiFacts: FilesAiGenerationFacts;
  constructor(aiFacts: FilesAiGenerationFacts) {
    super("workers_ai_invalid_metadata_output");
    this.aiFacts = aiFacts;
  }
}
const VALIDATION_ERROR =
  /failed to validate json|failed_generation|no (?:object|output) generated|response did not match schema|type validation failed/iu;
const CAPACITY_ERROR =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|429|3040)\b|capacity temporarily exceeded/iu;

const isCapacityError = (error: unknown): boolean => {
  if (error && typeof error === "object") {
    const facts = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
    };
    const status = facts.status ?? facts.statusCode;
    const code = facts.code;
    if (typeof status === "number" || typeof code === "number") {
      return status === 429 || code === 3040 || code === 3036;
    }
  }
  return CAPACITY_ERROR.test(
    error instanceof Error ? error.message : String(error)
  );
};

const responseText = (response: unknown): string | null => {
  if (typeof response === "string") {
    return response;
  }
  if (!response || typeof response !== "object") {
    return null;
  }
  const value = response as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = value.choices?.[0]?.message?.content ?? value.response;
  return typeof content === "string" ? content : null;
};

/** Signed caller supplies bounded text; this operation never fetches URLs. */
export const generateTextMetadataForOp = async (
  env: FilesOpsEnv,
  op: "generate-text-metadata" | "generate-link-metadata",
  params: Record<string, unknown>
): Promise<FilesTextMetadataOpResult> => {
  const prompt = params.prompt;
  if (
    typeof prompt !== "string" ||
    !prompt ||
    prompt.length > MAX_AI_METADATA_INPUT_CHARS ||
    Object.keys(params).some((key) => key !== "prompt")
  ) {
    throw new Error("invalid_metadata_params");
  }
  if (!env.AI) {
    throw new Error("workers_ai_not_configured");
  }
  const system =
    op === "generate-text-metadata"
      ? TEXT_ANALYSIS_SYSTEM_PROMPT
      : LINK_ANALYSIS_SYSTEM_PROMPT;
  const facts: FilesAiGenerationFacts = { validationRetryCount: 0 };
  for (
    let attempt = 0;
    attempt <= MAX_AI_METADATA_VALIDATION_RETRIES;
    attempt += 1
  ) {
    facts.validationRetryCount = attempt;
    let response: unknown;
    try {
      response = await env.AI.run(TEXT_METADATA_MODEL_ID, {
        max_tokens: MAX_AI_METADATA_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: validationRetryPrompt(prompt, attempt) },
        ],
        response_format: { type: "json_object" },
      });
    } catch (error) {
      if (isCapacityError(error)) {
        throw new MetadataCapacityError(facts);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (VALIDATION_ERROR.test(message)) {
        if (attempt >= MAX_AI_METADATA_VALIDATION_RETRIES) {
          throw new MetadataValidationError(facts);
        }
        continue;
      }
      // Provider exceptions can contain request bodies. Never propagate prompts
      // into operation logs or error envelopes.
      throw new Error("workers_ai_provider_failed");
    }
    if (response && typeof response === "object" && "usage" in response) {
      const usage = (
        response as {
          usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
        }
      ).usage;
      if (usage && typeof usage === "object") {
        for (const [source, destination] of [
          ["prompt_tokens", "inputTokens"],
          ["completion_tokens", "outputTokens"],
        ] as const) {
          const value = usage[source];
          if (
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0
          ) {
            facts.usage ??= {};
            facts.usage[destination] = (facts.usage[destination] ?? 0) + value;
          }
        }
      }
    }
    const raw = responseText(response);
    const result =
      raw === null || raw.length > 64 * 1024 ? null : parseTextMetadata(raw);
    if (result) {
      return { ...result, ...facts };
    }
  }
  throw new MetadataValidationError(facts);
};
