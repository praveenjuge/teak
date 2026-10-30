import { internal } from "@teak/convex/_generated/api";
import {
  type FilesImageTextResult,
  linkOcrSourceKeys,
  normalizeImageOcrText,
} from "@teak/files-protocol";
import { runWithAiUsage } from "../../ai/aiUsage";
import { type CardJob, guardOf, loadCard } from "./context";

export type LinkTextOutcome =
  | { status: "read"; hasText: boolean }
  | { status: "skipped" };

export const readLinkImageText = async (
  job: CardJob
): Promise<LinkTextOutcome> => {
  const loaded = await loadCard(job);
  const card = loaded?.card;
  if (card?.type !== "link" || card.isDeleted) {
    return { status: "skipped" };
  }
  const keys = linkOcrSourceKeys(card.metadata?.linkPreview);
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
      if ((await job.deps.aiGate(card.userId)) !== "allowed") {
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
