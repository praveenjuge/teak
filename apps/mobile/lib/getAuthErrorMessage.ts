import { isSignUpDisabledError } from "@teak/convex/shared/authErrors";
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";

interface BetterAuthError {
  cause?: string | null;
  error?:
    | string
    | {
        message?: string | null;
      }
    | null;
  message?: string | null;
  statusText?: string | null;
}

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Returns a user-friendly error message coming from Better Auth responses.
 */
function readAuthErrorMessage(error: unknown, fallbackMessage: string): string {
  if (isString(error)) {
    return error;
  }

  if (error && typeof error === "object") {
    const {
      message,
      cause,
      statusText,
      error: nestedError,
    } = error as BetterAuthError;

    if (isString(cause)) {
      return cause;
    }

    if (isString(message)) {
      return message;
    }

    if (isString(statusText)) {
      return statusText;
    }

    if (typeof nestedError === "string" && nestedError.trim().length > 0) {
      return nestedError;
    }

    if (
      nestedError &&
      typeof nestedError === "object" &&
      isString(nestedError.message)
    ) {
      return nestedError.message;
    }
  }

  return fallbackMessage;
}

export function getAuthErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  const message = readAuthErrorMessage(error, fallbackMessage);
  return isSignUpDisabledError(message) ? SIGNUPS_PAUSED_MESSAGE : message;
}
