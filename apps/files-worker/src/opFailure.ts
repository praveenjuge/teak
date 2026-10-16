import type { FilesErrorCode } from "@teak/files-protocol";

const OP_FAILURES = {
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
  not_an_image: { code: "UNSUPPORTED", retryable: false, status: 415 },
  source_changed: { code: "CONFLICT", retryable: false, status: 409 },
  source_not_found: { code: "NOT_FOUND", retryable: false, status: 404 },
  source_too_large: {
    code: "PAYLOAD_TOO_LARGE",
    retryable: false,
    status: 413,
  },
} as const satisfies Record<
  string,
  { code: FilesErrorCode; retryable: boolean; status: number }
>;

export type OpFailureCode = keyof typeof OP_FAILURES;

/** An operation failure with a known protocol answer; its message is the code. */
export class OpFailure extends Error {
  readonly code: OpFailureCode;

  constructor(code: OpFailureCode, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
  }

  get answer(): (typeof OP_FAILURES)[OpFailureCode] {
    return OP_FAILURES[this.code];
  }
}
