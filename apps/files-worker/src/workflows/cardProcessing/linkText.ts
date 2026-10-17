import { internal } from "@teak/convex/_generated/api";
import {
  type FilesImageTextResult,
  normalizeImageOcrText,
} from "@teak/files-protocol";
import { runWithAiUsage } from "../../aiUsage";
import { type CardJob, guardOf, loadCard } from "./context";

// The text in a link's images, for search only: its preview image
// (og:image) and its screenshot. It runs after the screenshot stage and never
// changes it.

export type LinkTextOutcome =
  | { status: "read"; hasText: boolean }
  | { status: "skipped" };

/**
 * Reads the link's preview image, then its screenshot, and stores their
 * text as `aiOcrText` with `ocrCheckedAt`. An image the op declines (gone,
 * or a format it can't decode) reads as none. A busy Workers AI throws, so
 * the step retries; the processing revision guards the write, so a newer
 * run's images are never given this run's text.
 */
export const readLinkImageText = async (
  job: CardJob
): Promise<LinkTextOutcome> => {
  const loaded = await loadCard(job);
  const card = loaded?.card;
  if (card?.type !== "link" || card.isDeleted) {
    return { status: "skipped" };
  }
  const preview = card.metadata?.linkPreview;
  const keys = [preview?.imageStorageKey, preview?.screenshotStorageKey].filter(
    (key): key is string => Boolean(key)
  );
  if (keys.length === 0) {
    return { status: "skipped" };
  }
  return await runWithAiUsage(
    {
      cardId: job.cardId,
      convexSiteUrl: job.convexSiteUrl,
      userId: card.userId,
    },
    async (): Promise<LinkTextOutcome> => {
      const aiGate = await job.deps.convex.query(
        internal.adminAccess.getAiGate,
        { userId: card.userId }
      );
      if (aiGate !== "allowed") {
        return { status: "skipped" };
      }
      const texts: string[] = [];
      for (const sourceKey of keys) {
        const outcome = await job.deps.filesOp<FilesImageTextResult>({
          op: "extract-image-text",
          params: { sourceKey },
        });
        if (outcome.kind === "ok" && outcome.data.text) {
          texts.push(outcome.data.text);
        }
      }
      const aiOcrText = normalizeImageOcrText(texts.join("\n\n")) ?? "";
      await job.deps.convex.mutation(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        { aiOcrText, cardId: job.cardId, ocrCheckedAt: Date.now() },
        guardOf(job)
      );
      return { hasText: aiOcrText !== "", status: "read" };
    }
  );
};
