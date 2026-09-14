"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { runAccountDataDeletion } from "./accountDeletion";
import { deleteAccountImportObjectsHandler } from "./import/runImport";
import { withBackendSpan } from "./telemetry/sentry";

export const deleteAccountData = internalAction({
  args: { userId: v.string() },
  returns: v.object({
    deletedCards: v.number(),
    deletedStorageObjectCount: v.number(),
  }),
  handler: async (ctx, { userId }) =>
    runAccountDataDeletion(ctx, userId, {
      deleteImportObjects: (objects) =>
        deleteAccountImportObjectsHandler(ctx, { objects }),
      observe: withBackendSpan,
    }),
});
