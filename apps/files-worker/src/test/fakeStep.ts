import type { WorkflowBackoff, WorkflowStepConfig } from "cloudflare:workers";
import type { StepConfig, StepContext, Steps } from "../workflows/runtime";

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
};
const DURATION = /^(\d+) (second|minute|hour)s?$/u;

/**
 * The wait Workflows applies after a failed attempt: the step's delay, or
 * what its delay function returned, scaled by `backoff` (exponential when
 * unset). Durations come back as they were given when nothing scales them.
 */
const withBackoff = (
  delay: unknown,
  backoff: WorkflowBackoff | undefined,
  attempt: number
): unknown => {
  const factor = {
    constant: 1,
    linear: attempt,
    exponential: 2 ** (attempt - 1),
  }[backoff ?? "exponential"];
  if (factor === 1) {
    return delay;
  }
  if (typeof delay === "number") {
    return delay * factor;
  }
  const match = typeof delay === "string" ? DURATION.exec(delay) : null;
  return match
    ? Number(match[1]) * (UNIT_MS[match[2] ?? ""] ?? 0) * factor
    : delay;
};

export interface StepRecord {
  attempts: number;
  name: string;
  outcome: "ok" | "error";
}

export const createFakeStep = (
  options: {
    failures?: Record<string, { error: Error; times: number }>;
    results?: Record<string, unknown>;
  } = {}
) => {
  const records: StepRecord[] = [];
  const sleeps: Array<{ duration: number | string; name: string }> = [];
  const delays: Array<{ attempt: number; delay: unknown; name: string }> = [];
  const failures = new Map(
    Object.entries(options.failures ?? {}).map(([name, failure]) => [
      name,
      { ...failure },
    ])
  );

  const run = async <T>(
    name: string,
    config: StepConfig | undefined,
    callback: (ctx: StepContext) => Promise<T>
  ): Promise<T> => {
    if (options.results && name in options.results) {
      records.push({ attempts: 0, name, outcome: "ok" });
      return options.results[name] as T;
    }
    const limit = config?.retries?.limit ?? 5;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const failure = failures.get(name);
        if (failure && failure.times > 0) {
          failure.times -= 1;
          throw failure.error;
        }
        const result = await callback({ attempt });
        records.push({ attempts: attempt, name, outcome: "ok" });
        return result;
      } catch (error) {
        const nonRetryable =
          error instanceof Error && error.name === "NonRetryableError";
        if (nonRetryable || attempt > limit) {
          records.push({ attempts: attempt, name, outcome: "error" });
          throw error;
        }
        const delay = config?.retries?.delay;
        const base =
          typeof delay === "function"
            ? await delay({
                ctx: {
                  attempt,
                  config: config as WorkflowStepConfig,
                  step: { count: 1, name },
                },
                error: error as Error,
              })
            : delay;
        delays.push({
          attempt,
          delay: withBackoff(base, config?.retries?.backoff, attempt),
          name,
        });
      }
    }
  };

  const step: Steps = {
    do: (<T>(
      name: string,
      configOrCallback: StepConfig | ((ctx: StepContext) => Promise<T>),
      maybeCallback?: (ctx: StepContext) => Promise<T>
    ) =>
      typeof configOrCallback === "function"
        ? run(name, undefined, configOrCallback)
        : run(name, configOrCallback, maybeCallback as never)) as Steps["do"],
    sleep: (name, duration) => {
      sleeps.push({ duration, name });
      return Promise.resolve();
    },
  };

  return {
    delays,
    names: () => records.map((record) => record.name),
    records,
    sleeps,
    step,
  };
};
