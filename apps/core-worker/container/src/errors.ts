import {
  RENDERER_ERROR_STATUS,
  RENDERER_MAX_INPUT_BYTES,
  type RendererErrorCode,
} from "./protocol";

const MAX_MESSAGE_CHARS = 500;
const FILE_PATH = /(?:file:)?\/[^\s:]+/g;

export class JobError extends Error {
  readonly code: RendererErrorCode;
  readonly status: number;

  constructor(code: RendererErrorCode, message: string) {
    super(message.trim().slice(0, MAX_MESSAGE_CHARS) || code);
    this.code = code;
    this.status = RENDERER_ERROR_STATUS[code];
  }
}

export const badRequest = (message: string) =>
  new JobError("bad_request", message);
export const unsupported = (message: string) =>
  new JobError("unsupported", message);
export const timedOut = () =>
  new JobError("timeout", "The job ran past its time limit");
export const tooLarge = () =>
  new JobError(
    "too_large",
    `The file is larger than ${String(RENDERER_MAX_INPUT_BYTES / 1024 / 1024)} MiB`
  );

export function toolFailure(
  result: { timedOut: boolean; stderr: string },
  what: string
): JobError {
  if (result.timedOut) {
    return timedOut();
  }
  const lines = result.stderr.trim().split("\n");
  const detail = lines.at(-1)?.replace(FILE_PATH, "input").trim();
  return unsupported(detail ? `${what}: ${detail}` : what);
}

export function errorResponse(error: JobError): Response {
  return Response.json(
    { error: error.code, message: error.message },
    { status: error.status }
  );
}
