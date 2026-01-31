interface BetterAuthError {
  message?: string | null;
  cause?: string | null;
  statusText?: string | null;
  error?:
    | string
    | {
        message?: string | null;
      }
    | null;
}

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Returns a user-friendly error message coming from Better Auth responses.
 */
export function getAuthErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
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
