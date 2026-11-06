import { TeakApiError } from "./errors";

export interface WaitOptions<T> {
  /** A fixed time between reads; by default 250 ms, doubling up to 3 s. */
  intervalMs?: number;
  /** Called with each value read while the work still runs. */
  onProgress?: (value: T) => void;
  /** Stops the wait early; it rejects with the signal's reason. */
  signal?: AbortSignal;
  /** The error to raise at the deadline; a TIMEOUT `TeakApiError` by default. */
  timedOut?: () => Error;
  /** How long to wait in all; 10 minutes by default. */
  timeoutMs?: number;
}

export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;
const FIRST_POLL_MS = 250;
const MAX_POLL_MS = 3000;

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

// A read still going at the deadline, or when the caller aborts, ends the
// wait too, so one slow request can't stretch the timeout or hold a cancel.
const beforeDeadline = async <T>(
  work: Promise<T>,
  deadline: number,
  timedOut: () => Error,
  signal?: AbortSignal
): Promise<T> => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw timedOut();
  }
  if (signal?.aborted) {
    throw signal.reason;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timedOut()), remaining);
        onAbort = () => reject(signal?.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
  }
};

/**
 * Reads `refresh` until `running` says the work is over, backing off between
 * reads, and gives up at the timeout so no wait runs forever. Returns the
 * last value read. `start` may be the first read still in flight; the
 * deadline and the signal cover it like every later read.
 */
export const waitFor = async <T>(
  start: T | Promise<T>,
  poll: {
    refresh: (value: T) => Promise<T>;
    running: (value: T) => boolean;
  } & WaitOptions<T>
): Promise<T> => {
  const timeoutMs = poll.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const timedOut =
    poll.timedOut ??
    (() =>
      new TeakApiError(
        "TIMEOUT",
        "Stopped waiting; the work keeps going in Teak."
      ));
  let value = await beforeDeadline(
    Promise.resolve(start),
    deadline,
    timedOut,
    poll.signal
  );
  let wait = poll.intervalMs ?? FIRST_POLL_MS;
  while (poll.running(value)) {
    if (Date.now() >= deadline) {
      throw timedOut();
    }
    poll.onProgress?.(value);
    await delay(
      Math.min(wait, Math.max(0, deadline - Date.now())),
      poll.signal
    );
    wait = poll.intervalMs ?? Math.min(wait * 2, MAX_POLL_MS);
    value = await beforeDeadline(
      poll.refresh(value),
      deadline,
      timedOut,
      poll.signal
    );
  }
  return value;
};
