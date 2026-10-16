"use node";

import type { FilesOp } from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { aiUsageParams } from "./usage";

/**
 * Clef decisions run in the Files Worker, which owns their prompts and
 * thresholds. This only sends the inputs and honours the AI gate. The Worker
 * records each model call in Analytics Engine, charged to the owner named in
 * `aiUsage`. Every failure is swallowed: a `null` result means keep the
 * rules' answer, so a decision can never fail a card or a search.
 */
export const CARD_PROCESSING_DECISION_TIMEOUT_MS = 3000;
export const SEARCH_DECISION_TIMEOUT_MS = 1500;

type DecisionOp = Extract<
  FilesOp,
  | "decide-card-type"
  | "decide-link-category"
  | "decide-visual-styles"
  | "score-relevance"
>;

export const isAiAllowedForUser = async (
  ctx: Pick<ActionCtx, "runQuery">,
  userId: string | undefined
): Promise<boolean> =>
  !!userId &&
  (await ctx.runQuery(internal.adminAccess.getAiGate, { userId })) ===
    "allowed";

export const runDecision = async <T>(
  ctx: Pick<ActionCtx, "runQuery">,
  {
    op,
    params,
    read,
    timeoutMs = CARD_PROCESSING_DECISION_TIMEOUT_MS,
    userId,
  }: {
    op: DecisionOp;
    params: Record<string, unknown>;
    read: (data: unknown) => T | null;
    timeoutMs?: number;
    userId: string | undefined;
  }
): Promise<T | null> => {
  if (!(isFilesWorkerConfigured() && userId)) {
    return null;
  }
  try {
    if (!(await isAiAllowedForUser(ctx, userId))) {
      return null;
    }
    const outcome = await callFilesWorkerJson<unknown>({
      op,
      params: { ...params, ...aiUsageParams(userId) },
      timeoutMs,
    });
    if (outcome.kind === "fallback") {
      return null;
    }
    const result = read(outcome.data);
    if (!result) {
      throw new Error("invalid_decision_reply");
    }
    return result;
  } catch (error) {
    console.warn("[ai/decisions] keeping the rules' answer", {
      message: error instanceof Error ? error.message : String(error),
      op,
    });
    return null;
  }
};
