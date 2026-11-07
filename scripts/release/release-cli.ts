import fs from "node:fs";

/** Helpers the release scripts share; they run under Node as well as Bun. */

export function required(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing ${label}.`);
  }
  return normalized;
}

/** Parses `--name value` pairs; every flag needs a value. */
export function parseArguments(
  args: readonly string[]
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!(flag?.startsWith("--") && value !== undefined)) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}.`);
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readJson<T = unknown>(
  path: string | undefined,
  label: string
): T {
  try {
    // A file the workflow wrote and passed by flag.
    // nosemgrep: javascript_pathtraversal_rule-non-literal-fs-filename
    return JSON.parse(fs.readFileSync(required(path, label), "utf8")) as T;
  } catch (error) {
    throw new Error(`Could not read ${label}: ${errorMessage(error)}`);
  }
}

/** A GitHub Actions run link, the only URL release issues link to. */
export function githubWorkflowUrl(value: string | undefined): string {
  const url = new URL(required(value, "workflow URL"));
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("Workflow URL must be an https://github.com URL.");
  }
  return url.toString();
}

export interface PollWindow {
  /** Most attempts, the first one included. */
  attempts?: number;
  /**
   * Whether one more attempt runs when the pause before it reaches the
   * deadline. Without it, the failure that started that pause is thrown.
   */
  finalAttempt?: boolean;
  /** Pause between attempts, cut short at the deadline. */
  intervalMs: number;
  now?: () => number;
  /** Called before each pause with the failure being retried. */
  onRetry?: (error: unknown, attempt: number) => void;
  /** Which failures are worth another attempt; any other is thrown at once. */
  retryOn: (error: unknown) => boolean;
  /** How long to keep trying, from the first attempt. */
  timeoutMs: number;
  wait?: (ms: number) => Promise<unknown>;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

/**
 * Runs `attempt` until it returns. A failure `retryOn` accepts is retried
 * after `intervalMs` while attempts and time remain; otherwise the failure is
 * thrown. `attempt` receives the milliseconds left before the deadline.
 * Release waits use this so each one states its bounds in one place.
 */
export async function pollUntil<T>(
  attempt: (remainingMs: number) => T | Promise<T>,
  {
    attempts = Number.POSITIVE_INFINITY,
    finalAttempt = true,
    intervalMs,
    now = Date.now,
    onRetry,
    retryOn,
    timeoutMs,
    wait = sleep,
  }: PollWindow
): Promise<T> {
  const deadline = now() + timeoutMs;
  for (let count = 1; ; count++) {
    try {
      return await attempt(Math.max(0, deadline - now()));
    } catch (error) {
      if (count >= attempts || now() >= deadline || !retryOn(error)) {
        throw error;
      }
      onRetry?.(error, count);
      await wait(Math.max(0, Math.min(intervalMs, deadline - now())));
      if (!finalAttempt && now() >= deadline) {
        throw error;
      }
    }
  }
}
