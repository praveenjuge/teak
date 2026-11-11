import type { WorkflowStepConfig } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { internal } from "@teak/convex/_generated/api";
import type {
  WorkflowCompletionStatus,
  WorkflowOriginParams,
} from "@teak/files-protocol";
import { type ConvexRpc, createConvexRpc } from "../convexRpc";
import { errorMessage } from "../errors";
import type { FilesOpsEnv } from "../ops";
import type { TelemetryEnvVars } from "../telemetry";

export interface BackgroundEnv extends FilesOpsEnv, TelemetryEnvVars {
  AI_BACKFILL?: Queue<unknown>;
  AI_USAGE?: AnalyticsEngineDataset;
  R2_EVENTS?: Queue<unknown>;
}

export interface StepContext {
  attempt: number;
}

export type StepConfig = WorkflowStepConfig;

export interface Steps {
  do: {
    <T>(name: string, callback: (ctx: StepContext) => Promise<T>): Promise<T>;
    <T>(
      name: string,
      config: StepConfig,
      callback: (ctx: StepContext) => Promise<T>
    ): Promise<T>;
  };
  sleep: (name: string, duration: number | string) => Promise<void>;
}

export interface WorkflowRun<Params> {
  env: BackgroundEnv;
  instanceId: string;
  params: Params & WorkflowOriginParams;
  step: Steps;
}

export const convexFor = (
  env: BackgroundEnv,
  params: WorkflowOriginParams
): ConvexRpc => createConvexRpc(env, params.convexSiteUrl);

export const CONVEX_STEP: StepConfig = {
  retries: { backoff: "exponential", delay: "5 seconds", limit: 8 },
  timeout: "2 minutes",
};

/**
 * A step Workflows tries `attempts` times in all, waiting `delayMs` before
 * the second try and doubling the wait after each one.
 */
export const exponentialStep = (
  attempts: number,
  delayMs: number,
  timeout: StepConfig["timeout"] = "10 minutes"
): StepConfig => ({
  retries: {
    backoff: "exponential",
    delay: delayMs,
    limit: Math.max(0, attempts - 1),
  },
  timeout,
});

/**
 * A step whose `delay` works out each wait itself. Constant backoff, or
 * Workflows' exponential backoff would scale the computed wait again.
 */
export const computedBackoff = (
  delay: NonNullable<StepConfig["retries"]>["delay"],
  limit: number,
  timeout: StepConfig["timeout"]
): StepConfig => ({
  retries: { backoff: "constant", delay, limit },
  timeout,
});

export const stepAttempts = (config: StepConfig): number =>
  (config.retries?.limit ?? 0) + 1;

/**
 * One durable step per page, named `${name} 1`, `${name} 2`, and so on from
 * `firstPage`: the names are workflow history, so they never change. Yields
 * each page's result; the caller stops with `break` or `return`. Runs at
 * most `maxPages` pages.
 */
export async function* stepPages<T>(
  step: Steps,
  name: string,
  config: StepConfig,
  body: (page: number, ctx: StepContext) => Promise<T>,
  { firstPage = 1, maxPages = Number.POSITIVE_INFINITY } = {}
): AsyncGenerator<T, void, undefined> {
  for (let page = firstPage; page < firstPage + maxPages; page += 1) {
    yield await step.do(`${name} ${page}`, config, (ctx) => body(page, ctx));
  }
}

export const NO_RETRY = (
  timeout: StepConfig["timeout"] = "10 minutes"
): StepConfig => ({ retries: { delay: 0, limit: 0 }, timeout });

export const runReported = async <T>(
  run: WorkflowRun<unknown>,
  body: () => Promise<T>,
  convex: ConvexRpc = convexFor(run.env, run.params)
): Promise<T> => {
  const report = async (status: WorkflowCompletionStatus, error?: string) => {
    try {
      await run.step.do(
        `report ${status}`,
        { retries: { backoff: "exponential", delay: "10 seconds", limit: 6 } },
        async () => {
          await convex.mutation(internal.workflowDispatch.complete, {
            instanceId: run.instanceId,
            status,
            ...(error ? { error: error.slice(0, 300) } : {}),
          });
          return null;
        }
      );
    } catch (reportError) {
      console.error("[workflows] completion report failed", {
        error: errorMessage(reportError),
        instanceId: run.instanceId,
      });
    }
  };
  let result: T;
  try {
    result = await body();
  } catch (error) {
    await report("errored", errorMessage(error));
    throw error;
  }
  await report("complete");
  return result;
};

export const stopRun = (reason: string): never => {
  throw new NonRetryableError(reason);
};
