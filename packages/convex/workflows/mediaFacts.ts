"use node";

import type { FilesMediaProbeResult } from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";

interface MediaCard {
  _id: string;
  fileKey?: string | null;
  fileMetadata?: {
    duration?: number;
    height?: number;
    width?: number;
  } | null;
}

const positiveNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

/**
 * Record duration and display size for an audio or video card from its
 * container headers (Files Worker `probe-media`). Optional: unsupported
 * containers, older Workers and transient failures leave the card unchanged.
 * Returns the card's duration afterwards, when known.
 */
export const recordMediaFacts = async (
  ctx: Pick<ActionCtx, "runMutation">,
  card: MediaCard,
  kind: "audio" | "video"
): Promise<number | undefined> => {
  const known = card.fileMetadata ?? {};
  const complete =
    known.duration !== undefined &&
    (kind === "audio" ||
      (known.width !== undefined && known.height !== undefined));
  if (!(card.fileKey && isFilesWorkerConfigured()) || complete) {
    return known.duration;
  }
  try {
    const outcome = await callFilesWorkerJson<FilesMediaProbeResult>({
      op: "probe-media",
      params: { sourceKey: card.fileKey },
    });
    if (outcome.kind !== "ok") {
      return known.duration;
    }
    const duration = positiveNumber(outcome.data.durationSeconds);
    const width = kind === "video" ? positiveNumber(outcome.data.width) : null;
    const height =
      kind === "video" ? positiveNumber(outcome.data.height) : null;
    const recordedDuration =
      known.duration ??
      (duration === null ? undefined : Math.round(duration * 1000) / 1000);
    if (duration === null && width === null && height === null) {
      return known.duration;
    }
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
      {
        cardId: card._id as never,
        ...(recordedDuration !== undefined && { duration: recordedDuration }),
        ...(width !== null && { width }),
        ...(height !== null && { height }),
      }
    );
    return recordedDuration;
  } catch (error) {
    console.warn("[mediaFacts] probe-media failed", {
      cardId: card._id,
      error: error instanceof Error ? error.message : String(error),
    });
    return known.duration;
  }
};
