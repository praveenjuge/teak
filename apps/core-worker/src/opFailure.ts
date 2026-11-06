import type {
  FilesAiGenerationFacts,
  FilesErrorCode,
} from "@teak/files-protocol";

/**
 * Every way an op can fail on purpose, and the answer each one gets. An
 * op throws `OpFailure` (or one of its named subclasses); anything else is
 * an internal error, reported and answered INTERNAL.
 */
const OP_FAILURES = {
  ai_capacity: { code: "AI_CAPACITY", retryable: false, status: 429 },
  ai_invalid_output: {
    code: "AI_INVALID_OUTPUT",
    retryable: true,
    status: 502,
  },
  archive_parse_failed: {
    code: "INVALID_INPUT",
    retryable: false,
    status: 400,
  },
  browser_unavailable: {
    code: "RENDERER_UNAVAILABLE",
    retryable: true,
    status: 503,
  },
  entry_too_large: {
    code: "PAYLOAD_TOO_LARGE",
    retryable: false,
    status: 413,
  },
  image_dimensions_missing: {
    code: "UNSUPPORTED",
    retryable: false,
    status: 415,
  },
  image_dimensions_too_large: {
    code: "UNSUPPORTED",
    retryable: false,
    status: 415,
  },
  image_transform_failed: {
    code: "UNSUPPORTED",
    retryable: false,
    status: 415,
  },
  invalid_input: { code: "INVALID_INPUT", retryable: false, status: 400 },
  not_an_image: { code: "UNSUPPORTED", retryable: false, status: 415 },
  renderer_declined: { code: "UNSUPPORTED", retryable: false, status: 415 },
  source_changed: { code: "CONFLICT", retryable: false, status: 409 },
  source_not_found: { code: "NOT_FOUND", retryable: false, status: 404 },
  source_too_large: {
    code: "PAYLOAD_TOO_LARGE",
    retryable: false,
    status: 413,
  },
  vector_rate_limited: { code: "RATE_LIMITED", retryable: true, status: 429 },
} as const satisfies Record<
  string,
  { code: FilesErrorCode; retryable: boolean; status: number }
>;

export type OpFailureCode = keyof typeof OP_FAILURES;
export type OpFailureAnswer = (typeof OP_FAILURES)[OpFailureCode];

export interface OpFailureOptions extends ErrorOptions {
  /** What the AI call had done when it failed, for the caller's telemetry. */
  aiFacts?: FilesAiGenerationFacts;
  /** The answer's message; the code when left out. */
  message?: string;
}

export class OpFailure extends Error {
  readonly aiFacts?: FilesAiGenerationFacts;
  readonly code: OpFailureCode;

  constructor(code: OpFailureCode, options: OpFailureOptions = {}) {
    const { aiFacts, message, ...errorOptions } = options;
    super(message ?? code, errorOptions);
    this.code = code;
    if (aiFacts) {
      this.aiFacts = aiFacts;
    }
  }

  get answer(): OpFailureAnswer {
    return OP_FAILURES[this.code];
  }
}

/** Parameters an op refuses; it answers INVALID_INPUT with the message. */
export class InvalidOpInput extends OpFailure {
  constructor(message: `invalid_${string}`, options?: ErrorOptions) {
    super("invalid_input", { ...options, message });
  }
}
