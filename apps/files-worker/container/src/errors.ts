export type ErrorCode =
  | "bad_request"
  | "too_large"
  | "unsupported"
  | "timeout"
  | "busy"
  | "internal"
  | "not_found";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  too_large: 413,
  unsupported: 415,
  timeout: 422,
  internal: 500,
  busy: 503,
};

const MAX_MESSAGE_CHARS = 500;
const FILE_PATH = /(?:file:)?\/[^\s:]+/g;

export class JobError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message.trim().slice(0, MAX_MESSAGE_CHARS) || code);
    this.code = code;
    this.status = STATUS[code];
  }
}

export const badRequest = (message: string) =>
  new JobError("bad_request", message);
export const unsupported = (message: string) =>
  new JobError("unsupported", message);
export const timedOut = () =>
  new JobError("timeout", "The job ran past its time limit");
export const tooLarge = () =>
  new JobError("too_large", "The file is larger than 100 MiB");

/** A tool that failed on its input: 422 when it ran out of time, else 415. */
export function toolFailure(
  result: { timedOut: boolean; stderr: string },
  what: string
): JobError {
  if (result.timedOut) {
    return timedOut();
  }
  const lines = result.stderr.trim().split("\n");
  // Tools name the spooled file by its full path; the caller only knows it
  // as the input.
  const detail = lines.at(-1)?.replace(FILE_PATH, "input").trim();
  return unsupported(detail ? `${what}: ${detail}` : what);
}

export function errorResponse(error: JobError): Response {
  return Response.json(
    { error: error.code, message: error.message },
    { status: error.status }
  );
}
