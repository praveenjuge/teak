import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";

/**
 * A seed card, optionally made to look like one saved before a field existed:
 * `noUrlKey` before link keys, `noShuffleKey` before Shuffle.
 */
export interface SeedCardDef extends DevScenarioCardDef {
  legacy?: { noShuffleKey?: true; noUrlKey?: true };
}

/** Inserts a pack's cards, counted as on Pro so packs can pass the free cap. */
export const insertSeedCards = async (
  ctx: MutationCtx,
  userId: string,
  cards: readonly SeedCardDef[]
): Promise<Id<"cards">[]> => {
  const ids = await insertCompletedCards(ctx, userId, cards, {
    hasPremium: true,
  });
  for (const [index, { legacy }] of cards.entries()) {
    if (legacy) {
      await ctx.db.patch("cards", ids[index], {
        ...(legacy.noUrlKey ? { urlKey: undefined } : {}),
        ...(legacy.noShuffleKey ? { shuffleKey: undefined } : {}),
      });
    }
  }
  return ids;
};

export const link = (
  url: string,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  type: "link",
  content: url,
  url,
  runProcessing: true,
  ...extra,
});

export const palette = (
  content: string,
  hexes: string[],
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  type: "palette",
  content,
  colors: hexes.map((hex) => ({ hex })),
  ...extra,
});

export const SCENARIO_MARKER = "teak-scenario";

export const bylineLink = (
  slug: string,
  url: string,
  linkPreview: Record<string, unknown>,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => {
  const markedUrl = `${url}#${SCENARIO_MARKER}-card-details-${slug}`;
  return {
    type: "link",
    content: markedUrl,
    url: markedUrl,
    tags: ["scenario-card-details"],
    metadataTitle:
      typeof linkPreview.title === "string" ? linkPreview.title : undefined,
    metadata: {
      linkPreview: {
        source: "scenario",
        status: "success",
        fetchedAt: Date.UTC(2026, 9, 1),
        url: markedUrl,
        finalUrl: markedUrl,
        ...linkPreview,
      } as never,
    },
    ...extra,
  };
};
