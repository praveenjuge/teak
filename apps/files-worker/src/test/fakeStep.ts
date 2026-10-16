import type { WorkflowStepConfig } from "cloudflare:workers";
import type { StepConfig, StepContext, Steps } from "../workflows/runtime";

export interface StepRecord {
  attempts: number;
  name: string;
  outcome: "ok" | "error";
}

/**
 * An in-memory stand-in for Cloudflare's `WorkflowStep`: runs each step's
 * callback with its retry limit (no delays), stops on `NonRetryableError`,
 * replays a completed step's result when its name repeats, and records
 * every step and sleep in order.
 */
export const createFakeStep = (
  options: {
    /** Fail these steps (by name) this many times before letting them run. */
    failures?: Record<string, { error: Error; times: number }>;
    /** Results to return for steps without running them. */
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
        delays.push({
          attempt,
          delay:
            typeof delay === "function"
              ? await delay({
                  ctx: {
                    attempt,
                    config: config as WorkflowStepConfig,
                    step: { count: 1, name },
                  },
                  error: error as Error,
                })
              : delay,
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
    /** Step names in the order they finished. */
    names: () => records.map((record) => record.name),
    records,
    sleeps,
    step,
  };
};
