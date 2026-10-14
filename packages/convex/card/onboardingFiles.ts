"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { buildR2ObjectKey, storeObject } from "../storage/r2";
import {
  ONBOARDING_CARDS,
  type OnboardingSlot,
  type OnboardingStored,
} from "./defaultCards";
import { ONBOARDING_FILES } from "./onboarding/files";

/** The storage key role for each slot, as the card pipeline names them. */
const SLOT_ROLES: Record<OnboardingSlot, string> = {
  file: "file",
  linkImage: "link-preview-image",
  screenshot: "screenshot",
  scrub: "scrub",
  thumbnail: "thumbnail",
};

const deleteObjects = (keys: string[]) =>
  Promise.all(
    keys.map((key) =>
      callFilesWorkerJson({ op: "delete-object", params: { key } }).catch(
        () => undefined
      )
    )
  );

/**
 * Store every getting-started file in a new account, all at once, then insert
 * the cards in one mutation. A card whose files fail to store is left out and
 * its stored files are deleted; the rest still arrive.
 */
export const addOnboardingCards = internalAction({
  args: { createdAt: v.number(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { createdAt, userId }) => {
    const results = await Promise.all(
      ONBOARDING_CARDS.filter((card) => card.uploads?.length).map(
        async (card): Promise<OnboardingStored | null> => {
          const entry: OnboardingStored = {
            onboarding: card.onboarding,
            keys: {},
          };
          const settled = await Promise.allSettled(
            (card.uploads ?? []).map(async (upload) => {
              const base64 = ONBOARDING_FILES[upload.source];
              if (!base64) {
                throw new Error(`missing_onboarding_file:${upload.source}`);
              }
              const bytes = Buffer.from(base64, "base64");
              const key = buildR2ObjectKey({
                userId,
                cardId: "stored",
                role: SLOT_ROLES[upload.slot],
                fileName: upload.name,
              });
              await storeObject(
                ctx,
                new Blob([bytes], { type: upload.mimeType }),
                { key, userId, type: upload.mimeType }
              );
              entry.keys[upload.slot] = key;
              if (upload.slot === "file") {
                entry.fileSize = bytes.byteLength;
              }
            })
          );
          const failure = settled.find(
            (result) => result.status === "rejected"
          );
          if (!failure) {
            return entry;
          }
          console.error("[onboarding] Storing a getting-started file failed", {
            onboarding: card.onboarding,
            error:
              failure.reason instanceof Error
                ? failure.reason.message
                : String(failure.reason),
          });
          await deleteObjects(Object.values(entry.keys) as string[]);
          return null;
        }
      )
    );
    const stored = results.filter(
      (entry): entry is OnboardingStored => entry !== null
    );
    try {
      await ctx.runMutation(internal.card.defaultCards.insertOnboardingCards, {
        createdAt,
        stored,
        userId,
      });
    } catch (error) {
      console.error("[onboarding] Adding the getting-started cards failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await deleteObjects(
        stored.flatMap((entry) => Object.values(entry.keys) as string[])
      );
    }
    return null;
  },
});
