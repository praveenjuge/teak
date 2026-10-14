"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { buildR2ObjectKey, storeObject } from "../storage/r2";
import { ONBOARDING_CARDS } from "./defaultCards";
import { ONBOARDING_FILES } from "./onboarding/files";

/**
 * Upload the getting-started image, voice memo, PDF, and video into a new
 * account, then add each as a card. Each file stands alone: one that fails is
 * logged and skipped, and the rest still arrive.
 */
export const addOnboardingFileCards = internalAction({
  args: {
    cards: v.array(v.object({ createdAt: v.number(), onboarding: v.string() })),
    folderId: v.optional(v.id("folders")),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { cards, folderId, userId }) => {
    for (const planned of cards) {
      const file = ONBOARDING_CARDS.find(
        (card) => card.onboarding === planned.onboarding
      )?.file;
      const base64 = file ? ONBOARDING_FILES[file.source] : undefined;
      if (!(file && base64)) {
        console.error("[onboarding] Missing getting-started file", {
          onboarding: planned.onboarding,
        });
        continue;
      }
      const bytes = Buffer.from(base64, "base64");
      const fileKey = buildR2ObjectKey({
        userId,
        cardId: "stored",
        role: "file",
        fileName: file.name,
      });
      try {
        await storeObject(ctx, new Blob([bytes], { type: file.mimeType }), {
          key: fileKey,
          userId,
          type: file.mimeType,
        });
      } catch (error) {
        console.error("[onboarding] Storing a getting-started file failed", {
          onboarding: planned.onboarding,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      try {
        await ctx.runMutation(
          internal.card.defaultCards.insertOnboardingFileCard,
          {
            createdAt: planned.createdAt,
            fileKey,
            fileSize: bytes.byteLength,
            folderId,
            onboarding: planned.onboarding,
            userId,
          }
        );
      } catch (error) {
        console.error("[onboarding] Adding a getting-started card failed", {
          onboarding: planned.onboarding,
          error: error instanceof Error ? error.message : String(error),
        });
        await callFilesWorkerJson({
          op: "delete-object",
          params: { key: fileKey },
        }).catch(() => undefined);
      }
    }
    return null;
  },
});
