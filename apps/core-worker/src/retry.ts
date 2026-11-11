export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryPolicy {
  /** Tries in all, the first included. */
  attempts: number;
  /** The wait after failed try `attempt` (1-based). */
  delayMs: (attempt: number) => number;
  isRetryable: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `run` until it succeeds, throws an error `isRetryable` refuses, or
 * has used every attempt; the last error is thrown as it was.
 */
export const withRetries = async <T>(
  run: (attempt: number) => Promise<T>,
  policy: RetryPolicy
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= policy.attempts || !policy.isRetryable(error)) {
        throw error;
      }
      await (policy.sleep ?? sleep)(policy.delayMs(attempt));
    }
  }
};
