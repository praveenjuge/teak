type BetterAuthError = {
  message?: string | null;
  cause?: string | null;
  statusText?: string | null;
  error?:
    | string
    | {
        message?: string | null;
      }
    | null;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Normalizes Better Auth error responses into a user-friendly string.
 */
export function getAuthErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (isNonEmptyString(error)) {
    return error;
  }

  if (error && typeof error === "object") {
    const {
      message,
      cause,
      statusText,
      error: nested,
    } = error as BetterAuthError;

    if (isNonEmptyString(cause)) {
      return cause;
    }

    if (isNonEmptyString(message)) {
      return message;
    }

    if (isNonEmptyString(statusText)) {
      return statusText;
    }

    if (isNonEmptyString(nested)) {
      return nested;
    }

    if (
      nested &&
      typeof nested === "object" &&
      isNonEmptyString(nested.message)
    ) {
      return nested.message;
    }
  }

  return fallbackMessage;
}
