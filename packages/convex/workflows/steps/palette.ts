"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import {
  callFilesWorkerJson,
  type FilesWorkerImageAnalysisResult,
} from "../../storage/filesWorkerClient";
import { withBackendSpan } from "../../telemetry/sentry";
import { hasKnownTinyImageDimensions } from "../imageAnalysis";

export const extractPaletteFromImage = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (ctx, { cardId }) =>
    withBackendSpan(
      {
        cardId,
        name: "card.palette",
        operation: TELEMETRY_OPERATIONS.storageRender,
        stage: "palette",
        surface: "backend",
      },
      async () => {
        const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
          cardId,
        });

        if (card?.type !== "image" || !card.fileKey) {
          return;
        }

        // If palette already exists, skip recomputation
        if (Array.isArray(card.colors) && card.colors.length > 0) {
          return card.colors as any;
        }

        if (hasKnownTinyImageDimensions(card.fileMetadata)) {
          return;
        }

        try {
          const outcome =
            await callFilesWorkerJson<FilesWorkerImageAnalysisResult>({
              op: "analyze-image",
              params: { sourceKey: card.fileKey },
            });
          if (outcome.kind !== "ok") {
            return;
          }
          const { width, height, palette } = outcome.data;
          if (
            !Array.isArray(palette) ||
            palette.length === 0 ||
            hasKnownTinyImageDimensions({ height, width })
          ) {
            return;
          }
          await ctx.runMutation(
            internal.workflows.steps.renderables.mutations
              .updateCardFileMetadata,
            { cardId, height, width }
          );
          const colors = palette.map((hex) => ({ hex }));
          await ctx.runMutation(
            internal.workflows.aiMetadata.mutations.updateCardColors,
            { cardId, colors }
          );
          return colors as any;
        } catch {}
      }
    ),
});
