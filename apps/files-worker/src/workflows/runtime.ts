import type { WorkflowStepConfig } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { internal } from "@teak/convex/_generated/api";
import type { WorkflowOriginParams } from "@teak/files-protocol";
import { type ConvexRpc, createConvexRpc } from "../convexRpc";
import type { FilesOpsEnv } from "../ops";
import type { TelemetryEnvVars } from "../telemetry";

export interface BackgroundEnv extends FilesOpsEnv, TelemetryEnvVars {
  AI_BACKFILL?: Queue<unknown>;
  AI_USAGE?: AnalyticsEngineDataset;
  R2_EVENTS?: Queue<unknown>;
  WORKOS_EVENTS?: Queue<unknown>;
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
 * Convex `{maxAttempts, initialBackoffMs, base}` retry settings as a step
 * config. Cloudflare's exponential backoff doubles; the attempt counts match.
 */
export const retryConfig = (
  maxAttempts: number,
  initialBackoffMs: number,
  timeout: StepConfig["timeout"] = "10 minutes"
): StepConfig => ({
  retries: {
    backoff: "exponential",
    delay: initialBackoffMs,
    limit: Math.max(0, maxAttempts - 1),
  },
  timeout,
});

export const NO_RETRY = (
  timeout: StepConfig["timeout"] = "10 minutes"
): StepConfig => ({ retries: { delay: 0, limit: 0 }, timeout });

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runReported = async <T>(
  run: WorkflowRun<unknown>,
  body: () => Promise<T>,
  convex: ConvexRpc = convexFor(run.env, run.params)
): Promise<T> => {
  const report = async (status: "complete" | "errored", error?: string) => {
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
