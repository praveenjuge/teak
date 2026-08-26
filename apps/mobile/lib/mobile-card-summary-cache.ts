import type { Id } from "@teak/convex/_generated/dataModel";
import type { CardType } from "@teak/convex/shared";

export interface MobileCardSummary {
  _creationTime: number;
  _id: Id<"cards">;
  colors?: string[];
  compactUrl?: string;
  fileName?: string;
  previewText?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
  title: string;
  type: CardType;
  url?: string;
}

const MAX_CACHED_SUMMARIES = 20;
const cachedSummaries = new Map<string, MobileCardSummary>();

export const rememberMobileCardSummary = (summary: MobileCardSummary) => {
  cachedSummaries.delete(summary._id);
  cachedSummaries.set(summary._id, summary);

  while (cachedSummaries.size > MAX_CACHED_SUMMARIES) {
    const oldestId = cachedSummaries.keys().next().value;
    if (!oldestId) {
      return;
    }
    cachedSummaries.delete(oldestId);
  }
};

export const getRememberedMobileCardSummary = (id: string) =>
  cachedSummaries.get(id);
