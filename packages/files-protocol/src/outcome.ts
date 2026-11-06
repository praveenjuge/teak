import {
  type FilesAiGenerationFacts,
  readFilesAiGenerationFacts,
} from "./metadata";
import type { FilesEnvelope, FilesErrorCode } from "./ops";

/** Codes every caller takes as "the op can't do this" rather than a failure. */
export const FILES_DECLINE_CODES = [
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED",
] as const satisfies readonly FilesErrorCode[];

/**
 * An op either answers or declines; anything else throws `FilesOpError`, so
 * the caller's retries apply.
 */
export type FilesOpOutcome<T> =
  | { data: T; kind: "ok" }
  | { code: FilesErrorCode; kind: "declined"; message: string };

const ERROR_PREFIX = "files_worker_error";

/**
 * An op that failed. A workflow step keeps only an error's name and
 * message, so the code also travels in the message
 * (`files_worker_error:<CODE>:<status>:<requestId>`), where
 * `filesOpErrorCode` reads it back.
 */
export class FilesOpError extends Error {
  readonly aiFacts?: FilesAiGenerationFacts;
  readonly code: FilesErrorCode;
  readonly retryable: boolean;

  constructor({
    aiFacts,
    code,
    requestId,
    retryable,
    status,
  }: {
    aiFacts?: FilesAiGenerationFacts | null;
    code: FilesErrorCode;
    requestId: string;
    retryable: boolean;
    status: number;
  }) {
    super(`${ERROR_PREFIX}:${code}:${String(status)}:${requestId}`);
    this.name = "FilesOpError";
    this.code = code;
    this.retryable = retryable;
    if (aiFacts) {
      this.aiFacts = aiFacts;
    }
  }
}

const ERROR_CODE = new RegExp(`${ERROR_PREFIX}:([A-Z_]+):`, "u");

/** The op error code an error carries, even after it crossed a step. */
export const filesOpErrorCode = (error: unknown): FilesErrorCode | null => {
  if (error instanceof FilesOpError) {
    return error.code;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (ERROR_CODE.exec(message)?.[1] as FilesErrorCode | undefined) ?? null;
};

/**
 * Turns an op's answer into its outcome. A missing or unreadable envelope
 * counts as a retryable INTERNAL failure.
 */
export const readFilesOpOutcome = <T>(
  envelope: FilesEnvelope<T> | null,
  status: number,
  declineCodes: readonly FilesErrorCode[] = []
): FilesOpOutcome<T> => {
  if (envelope?.ok && status >= 200 && status < 300) {
    return { data: envelope.data, kind: "ok" };
  }
  const error = envelope && !envelope.ok ? envelope.error : null;
  const code = error?.code ?? "INTERNAL";
  if (
    (FILES_DECLINE_CODES as readonly FilesErrorCode[]).includes(code) ||
    declineCodes.includes(code)
  ) {
    return {
      code,
      kind: "declined",
      message: error ? String(error.message).slice(0, 200) : code,
    };
  }
  throw new FilesOpError({
    aiFacts: error ? readFilesAiGenerationFacts(error.aiFacts) : null,
    code,
    requestId: error?.requestId ?? "unknown",
    retryable: error?.retryable ?? true,
    status,
  });
};

/**
 * Codes a later try may clear: a busy or rate-limited provider, or AI output
 * that failed validation this time.
 */
export const FILES_TRANSIENT_ERROR_CODES = [
  "AI_CAPACITY",
  "AI_INVALID_OUTPUT",
  "RATE_LIMITED",
] as const satisfies readonly FilesErrorCode[];

export const isTransientFilesOpCode = (code: FilesErrorCode): boolean =>
  (FILES_TRANSIENT_ERROR_CODES as readonly FilesErrorCode[]).includes(code);
