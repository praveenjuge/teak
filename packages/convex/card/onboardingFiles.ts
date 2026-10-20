import type { FilesStoreOnboardingFilesResult } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { buildR2ObjectKey } from "../storage/r2";
import {
  ONBOARDING_CARDS,
  type OnboardingSlot,
  type OnboardingStored,
} from "./defaultCards";

const SLOT_ROLES: Record<OnboardingSlot, string> = {
  file: "file",
  linkImage: "link-preview-image",
  screenshot: "screenshot",
  scrub: "scrub",
  thumbnail: "thumbnail",
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const deleteObjects = (keys: string[]) =>
  keys.length === 0
    ? Promise.resolve()
    : callFilesWorkerJson({ op: "delete-objects", params: { keys } }).then(
        () => undefined,
        () => undefined
      );

const planFiles = (userId: string) =>
  ONBOARDING_CARDS.filter((card) => card.uploads?.length).map((card) => ({
    onboarding: card.onboarding,
    files: (card.uploads ?? []).map((upload) => ({
      contentType: upload.mimeType,
      key: buildR2ObjectKey({
        userId,
        cardId: "stored",
        role: SLOT_ROLES[upload.slot],
        fileName: upload.name,
      }),
      slot: upload.slot,
      source: upload.source,
    })),
  }));

/**
 * Has the Files Worker copy the getting-started files it ships into the
 * account, and returns the cards whose files all landed.
 */
const storeOnboardingFiles = async (
  ctx: Pick<ActionCtx, "runMutation">,
  userId: string
): Promise<OnboardingStored[]> => {
  const planned = planFiles(userId);
  const keys = planned.flatMap((card) => card.files.map((file) => file.key));
  let called = false;
  try {
    if (
      !(await ctx.runMutation(internal.storage.ownership.registerObjects, {
        keys,
        userId,
      }))
    ) {
      throw new Error("account_storage_write_denied");
    }
    called = true;
    const outcome = await callFilesWorkerJson<FilesStoreOnboardingFilesResult>({
      op: "store-onboarding-files",
      params: {
        cards: planned.map((card) => ({
          onboarding: card.onboarding,
          files: card.files.map(({ contentType, key, source }) => ({
            contentType,
            key,
            source,
          })),
        })),
      },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`files_worker_declined:${outcome.code}`);
    }
    const stored: OnboardingStored[] = [];
    for (const result of outcome.data.cards) {
      const plan = planned.find(
        (card) => card.onboarding === result.onboarding
      );
      if (!plan) {
        continue;
      }
      if (!result.stored) {
        console.error("[onboarding] Storing a getting-started file failed", {
          onboarding: result.onboarding,
          error: result.error,
        });
        continue;
      }
      const sizes = new Map(result.files.map((file) => [file.key, file.size]));
      const entry: OnboardingStored = { onboarding: plan.onboarding, keys: {} };
      for (const file of plan.files) {
        entry.keys[file.slot] = file.key;
        if (file.slot === "file") {
          entry.fileSize = sizes.get(file.key);
        }
      }
      stored.push(entry);
    }
    return stored;
  } catch (error) {
    console.error("[onboarding] Storing the getting-started files failed", {
      error: errorMessage(error),
    });
    if (called) {
      // The Worker may have written some before the call failed.
      await deleteObjects(keys);
    }
    return [];
  }
};

export const addOnboardingCards = internalAction({
  args: { createdAt: v.number(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { createdAt, userId }) => {
    const stored = await storeOnboardingFiles(ctx, userId);
    const storedKeys = stored.flatMap(
      (entry) => Object.values(entry.keys) as string[]
    );
    try {
      const inserted = await ctx.runMutation(
        internal.card.defaultCards.insertOnboardingCards,
        { createdAt, stored, userId }
      );
      if (inserted === 0) {
        await deleteObjects(storedKeys);
      }
    } catch (error) {
      console.error("[onboarding] Adding the getting-started cards failed", {
        error: errorMessage(error),
      });
      await deleteObjects(storedKeys);
      await ctx
        .runMutation(internal.card.defaultCards.insertOnboardingCards, {
          createdAt,
          stored: [],
          userId,
        })
        .catch((fallbackError: unknown) => {
          console.error("[onboarding] The fallback cards failed too", {
            error: errorMessage(fallbackError),
          });
        });
    }
    return null;
  },
});
