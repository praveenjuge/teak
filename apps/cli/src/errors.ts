import { CommanderError, InvalidArgumentError } from "commander";
import { TeakApiError, type TeakApiErrorCode } from "teak-sdk";

/** A failure the CLI itself raises, with the command that gets past it. */
export class CliError extends TeakApiError {
  next?: string;

  constructor(
    code: TeakApiErrorCode,
    message: string,
    init?: { next?: string; retryAt?: number; status?: number }
  ) {
    super(code, message, init);
    this.next = init?.next;
  }
}

export interface ErrorContext {
  apiUrl: string;
  /** The command that ran, such as "cards get". */
  command?: string;
  /** The ids the command was given, when its first argument takes ids. */
  ids?: string[];
  now?: number;
}

export interface ErrorReport {
  code: string;
  message: string;
  next?: string;
  requestId?: string;
  retryAt?: number;
  status?: number;
}

/** A flag or argument the command can't take: the user's to fix. */
export const isUsage = (error: unknown) =>
  error instanceof InvalidArgumentError ||
  (error instanceof CommanderError && error.exitCode !== 0);

const waitText = (retryAt: number, now: number) => {
  const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  if (seconds < 90) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) {
    return `${minutes} minutes`;
  }
  return `${Math.ceil(minutes / 60)} hours`;
};

// Commands whose ids name cards, so a missing one can point at search.
const takesCardIds = (command?: string) =>
  Boolean(command) &&
  !/^(highlights|tags|folders|export)\b/.test(command ?? "") &&
  !/^highlights (note|delete|rm)/.test(command ?? "");

const helpCommand = (command?: string) =>
  `teak${command ? ` ${command}` : ""} --help`;

export const nextStepFor = (
  error: unknown,
  context: ErrorContext
): string | undefined => {
  if (error instanceof CliError && error.next) {
    return error.next;
  }
  if (isUsage(error)) {
    return `See the options with: ${helpCommand(context.command)}`;
  }
  if (!(error instanceof TeakApiError)) {
    return;
  }
  switch (error.kind) {
    case "auth":
      return "Sign in with: teak login (or set TEAK_API_KEY)";
    case "rate_limited":
      return error.retryAt
        ? `Try again in ${waitText(error.retryAt, context.now ?? Date.now())}.`
        : "Wait a moment, then try again.";
    case "network":
      return error.code === "TIMEOUT"
        ? "Try again, or allow longer with TEAK_API_REQUEST_TIMEOUT_MS (milliseconds)."
        : `Check your connection. The CLI is using ${context.apiUrl} (set TEAK_API_URL to change it).`;
    case "unavailable":
    case "server":
      return error.code === "PARSE_ERROR" || error.code === "REQUEST_FAILED"
        ? undefined
        : "Try again in a moment.";
    case "not_found":
      return error.code === "NOT_FOUND" &&
        context.ids?.length &&
        takesCardIds(context.command)
        ? 'Find a card\'s id with: teak search "<words>" (or teak trash for cards in Trash)'
        : undefined;
    default:
      return;
  }
};

const withId = (message: string, error: unknown, context: ErrorContext) => {
  const id = context.ids?.length === 1 ? context.ids[0] : undefined;
  return error instanceof TeakApiError &&
    error.code === "NOT_FOUND" &&
    id &&
    !message.includes(id)
    ? `${message}: ${id}`
    : message;
};

const codeFor = (error: unknown) => {
  if (error instanceof TeakApiError) {
    return error.code;
  }
  return isUsage(error) ? "USAGE" : "REQUEST_FAILED";
};

export const describeError = (
  error: unknown,
  context: ErrorContext
): ErrorReport => {
  const raw =
    error instanceof Error ? error.message : String(error ?? "Request failed");
  const message = withId(raw.replace(/^error: /, "").trim(), error, context);
  const next = nextStepFor(error, context);
  const api = error instanceof TeakApiError ? error : undefined;
  return {
    code: codeFor(error),
    message,
    ...(next ? { next } : {}),
    ...(api?.requestId ? { requestId: api.requestId } : {}),
    ...(api?.retryAt ? { retryAt: api.retryAt } : {}),
    ...(api?.status ? { status: api.status } : {}),
  };
};

/** The headline, then the request id to quote, then what to do next. */
export const formatErrorText = (report: ErrorReport) =>
  [
    report.message,
    ...(report.requestId ? [`Request ID: ${report.requestId}`] : []),
    ...(report.next ? [report.next] : []),
  ].join("\n");
