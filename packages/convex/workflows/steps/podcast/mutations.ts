import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { r2KeyValidator } from "../../../schema";
import { rateLimiter } from "../../../shared/rateLimits";
import { buildR2UserPrefix } from "../../../storage/r2";

// What the Files Worker's podcast step asks of Convex: a transcription slot
// for the card's owner, and a place on the card for the episode's audio
// while it is stored, so deleting the card deletes it too.

/** One of the owner's podcast transcriptions this hour; false past the limit. */
export const takePodcastTranscriptSlot = internalMutation({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const status = await rateLimiter.limit(ctx, "podcastTranscription", {
      key: userId,
      throws: false,
    });
    return status.ok;
  },
});

/**
 * Records (or, once it is deleted, forgets) the episode audio stored for a
 * card's transcription among the card's own objects.
 */
export const trackPodcastAudio = internalMutation({
  args: { cardId: v.id("cards"), key: r2KeyValidator, stored: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, { cardId, key, stored }) => {
    const card = await ctx.db.get("cards", cardId);
    // Only an object in the owner's own storage is the card's.
    if (!(card && key.startsWith(`${buildR2UserPrefix(card.userId)}/`))) {
      return false;
    }
    const keys = (card.workflowArtifactKeys ?? []).filter(
      (existing) => existing !== key
    );
    await ctx.db.patch("cards", cardId, {
      workflowArtifactKeys: stored ? [...keys, key] : keys,
    });
    return true;
  },
});
