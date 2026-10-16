import { internal } from "@teak/convex/_generated/api";
import {
  CLEF_FLASH_MODEL_ID,
  CLEF_MODEL_ID,
  type FilesOp,
} from "@teak/files-protocol";
import { currentAiUsageContext, runWithAiUsage } from "../../aiUsage";
import {
  observeAiGeneration,
  type WorkflowTelemetry,
  withWorkflowTelemetry,
} from "../telemetry";
import type { CardJob } from "./context";

/**
 * Clef decisions inside card-processing steps. The decision ops own their
 * prompts and thresholds; this only sends the inputs, honours the owner's AI
 * gate, charges the call to the owner and swallows every failure: `null`
 * means keep the rules' answer, so a decision never fails a card.
 */
export const CARD_PROCESSING_DECISION_TIMEOUT_MS = 3000;

export type DecisionOp = Extract<
  FilesOp,
  "decide-card-type" | "decide-link-category" | "decide-visual-styles"
>;

const DECISION_MODELS: Record<DecisionOp, string> = {
  "decide-card-type": CLEF_FLASH_MODEL_ID,
  "decide-link-category": CLEF_MODEL_ID,
  "decide-visual-styles": CLEF_FLASH_MODEL_ID,
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("decision_timed_out")),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const runDecision = async <T>(
  job: CardJob,
  {
    op,
    params,
    read,
    telemetry,
    timeoutMs = CARD_PROCESSING_DECISION_TIMEOUT_MS,
    userId,
  }: {
    op: DecisionOp;
    params: Record<string, unknown>;
    read: (data: unknown) => T | null;
    /** The step's batch; without one, the decision sends its own. */
    telemetry?: WorkflowTelemetry;
    timeoutMs?: number;
    userId: string | undefined;
  }
): Promise<T | null> => {
  if (!userId) {
    return null;
  }
  try {
    const gate = await job.deps.convex.query(internal.adminAccess.getAiGate, {
      userId,
    });
    if (gate !== "allowed") {
      return null;
    }
    const decide = (batch: WorkflowTelemetry) =>
      observeAiGeneration(
        batch,
        {
          functionId: `teak.ai.decision.${op}`,
          model: DECISION_MODELS[op],
          traceId: job.cardId,
        },
        async () => {
          const outcome = await withTimeout(
            job.deps.filesOp<unknown>({ op, params }),
            timeoutMs
          );
          if (outcome.kind === "fallback") {
            return null;
          }
          const result = read(outcome.data);
          if (!result) {
            throw new Error("invalid_decision_reply");
          }
          return result;
        }
      );
    // Counted in the owner's daily AI usage. Inside a step that already
    // charges its owner (metadata), the call adds to that.
    const metered = (batch: WorkflowTelemetry) =>
      currentAiUsageContext()
        ? decide(batch)
        : runWithAiUsage(
            {
              cardId: job.cardId,
              convexSiteUrl: job.convexSiteUrl,
              userId,
            },
            () => decide(batch)
          );
    return telemetry
      ? await metered(telemetry)
      : await withWorkflowTelemetry(job.env, metered);
  } catch (error) {
    console.warn("[cardProcessing/decisions] keeping the rules' answer", {
      cardId: job.cardId,
      message: error instanceof Error ? error.message : String(error),
      op,
    });
    return null;
  }
};
