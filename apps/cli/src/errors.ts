import { CommanderError, InvalidArgumentError } from "commander";
import {
  type OAuthFailure,
  OAuthSessionError,
  TeakApiError,
  type TeakApiErrorCode,
} from "teak-sdk";

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
  /** Every bad value, when a command was given more than one. */
  problems?: string[];
  /** What kind of failure, for a script or agent to branch on. */
  reason: ErrorReason;
  requestId?: string;
  retryAt?: number;
  status?: number;
}

/**
 * Why a command failed, one stable word a script can branch on without
 * reading the message. `code` stays the API's or the CLI's own code.
 */
export const ERROR_REASONS = [
  "cancelled",
  "confirmation_required",
  "conflict",
  "config",
  "forbidden",
  "invalid_input",
  "invalid_usage",
  "limit_reached",
  "login_failed",
  "login_required",
  "missing_input",
  "network",
  "not_found",
  "rate_limited",
  "server",
  "timed_out",
  "unavailable",
  "unknown",
] as const;

export type ErrorReason = (typeof ERROR_REASONS)[number];

/** A destructive command ran where no one can answer its (y/N) question. */
export class ConfirmationRequiredError extends InvalidArgumentError {}

/** Several bad values at once, reported together. */
export class InputProblemsError extends InvalidArgumentError {
  problems: string[];

  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}

/** Ctrl+C or a signal stopped the command; `next` says what is still true. */
export class InterruptedError extends Error {
  next?: string;

  constructor(next?: string) {
    super("Stopped.");
    this.next = next;
  }
}

/** What went wrong signing in, in the CLI's words; the next step follows. */
const SIGN_IN_WORDS: Record<OAuthFailure, string> = {
  account_changed: "The signed-in account changed.",
  account_unverified: "Could not verify your account.",
  cancelled: "Sign-in was not completed.",
  not_verified: "Sign-in was not completed.",
  previous_kept:
    "Your existing session is still saved. Run teak logout before signing in again.",
  provider_changed:
    "Authentication changed during sign-in. Run teak login again.",
  sign_out_first:
    "Run teak logout before signing in again, then wait 15 minutes for disconnect to finish.",
  signed_out: "Sign-in was cancelled by logout. Run teak login again.",
  token_rejected: "Could not complete Teak sign-in.",
  unexpected_issuer:
    "Discovered authentication server does not match TEAK_AUTH_URL.",
};

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
  if (
    (error instanceof CliError || error instanceof InterruptedError) &&
    error.next
  ) {
    return error.next;
  }
  if (isUsage(error)) {
    return context.command
      ? `See the options with: ${helpCommand(context.command)}`
      : "Add --help to the command to see its options.";
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
  if (error instanceof InterruptedError) {
    return "CANCELLED";
  }
  return isUsage(error) ? "USAGE" : "REQUEST_FAILED";
};

// Commander's codes for a required argument or value that wasn't given.
const MISSING_INPUT_CODES = new Set([
  "commander.missingArgument",
  "commander.missingMandatoryOptionValue",
  "commander.optionMissingArgument",
]);

const REASON_BY_KIND: Record<TeakApiError["kind"], ErrorReason> = {
  auth: "login_required",
  config: "config",
  conflict: "conflict",
  forbidden: "forbidden",
  invalid: "invalid_input",
  limit: "limit_reached",
  network: "network",
  not_found: "not_found",
  rate_limited: "rate_limited",
  server: "server",
  unavailable: "unavailable",
};

export const reasonFor = (error: unknown): ErrorReason => {
  if (error instanceof InterruptedError) {
    return "cancelled";
  }
  if (error instanceof ConfirmationRequiredError) {
    return "confirmation_required";
  }
  if (error instanceof CommanderError && MISSING_INPUT_CODES.has(error.code)) {
    return "missing_input";
  }
  if (isUsage(error)) {
    return "invalid_usage";
  }
  if (error instanceof OAuthSessionError) {
    return "login_failed";
  }
  if (error instanceof TeakApiError) {
    return error.code === "TIMEOUT" ? "timed_out" : REASON_BY_KIND[error.kind];
  }
  return "unknown";
};

export const describeError = (
  error: unknown,
  context: ErrorContext
): ErrorReport => {
  let raw =
    error instanceof Error ? error.message : String(error ?? "Request failed");
  if (error instanceof OAuthSessionError) {
    raw = SIGN_IN_WORDS[error.reason];
  }
  const message = withId(raw.replace(/^error: /, "").trim(), error, context);
  const next = nextStepFor(error, context);
  const api = error instanceof TeakApiError ? error : undefined;
  return {
    code: codeFor(error),
    message,
    reason: reasonFor(error),
    ...(next ? { next } : {}),
    ...(error instanceof InputProblemsError && error.problems.length > 1
      ? { problems: error.problems }
      : {}),
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
