import type { Doc } from "../_generated/dataModel";
import { isHiddenTagList } from "../shared/tags";
import { cardSiteHost } from "../shared/utils/urlHost";
import { urlKey } from "../shared/utils/urlKey";

/** True until the card has an AI summary, AI tags or a transcript. */
export const cardNeedsAiMetadata = (
  card: Pick<Doc<"cards">, "aiSummary" | "aiTags" | "aiTranscriptCharCount">
): boolean =>
  card.aiSummary === undefined &&
  card.aiTags === undefined &&
  card.aiTranscriptCharCount === undefined;

export type DerivedCardFields = Pick<
  Doc<"cards">,
  "aiPending" | "isHidden" | "urlHost" | "urlKey"
>;

export const DERIVED_CARD_FIELDS = [
  "aiPending",
  "isHidden",
  "urlHost",
  "urlKey",
] as const satisfies readonly (keyof DerivedCardFields)[];

export const DERIVED_FROM_FIELDS = [
  "aiSummary",
  "aiTags",
  "aiTranscriptCharCount",
  "sourceUrl",
  "tags",
  "url",
] as const satisfies readonly (keyof Doc<"cards">)[];

/**
 * The fields every card stores only so an index can find it: its site, the
 * link's key for duplicate checks, whether a hidden tag hides it, and whether
 * it still waits for AI metadata. Every card write sets them from the rest of
 * the card, so they never disagree with it.
 */
export const deriveCardFields = (
  card: Pick<Doc<"cards">, (typeof DERIVED_FROM_FIELDS)[number]>
): DerivedCardFields => ({
  aiPending: cardNeedsAiMetadata(card) ? true : undefined,
  isHidden: isHiddenTagList(card.tags) ? true : undefined,
  urlHost: cardSiteHost(card) ?? undefined,
  urlKey: card.url ? urlKey(card.url) : undefined,
});
