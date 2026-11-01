import type { Doc } from "@teak/convex/_generated/dataModel";
import { filterLocalCards } from "@teak/convex/shared";

type FilterOptions = NonNullable<Parameters<typeof filterLocalCards>[1]>;
type ListedCard = Doc<"cards"> & { matchedByMeaning?: true };

/**
 * The cards in a search's results that only its meaning found. The server
 * marks every strong meaning match `matchedByMeaning`, including ones that
 * also hold the words, and the mark lets a card skip the every-word check.
 * So a marked card is related only when, without the mark, that same check
 * would leave it out; one that holds every word is a word match.
 */
export function relatedOnlyCardIds(
  cards: readonly Doc<"cards">[],
  options: FilterOptions
): Set<string> {
  const ids = new Set<string>();
  for (const card of cards as readonly ListedCard[]) {
    if (card.matchedByMeaning !== true) {
      continue;
    }
    const { matchedByMeaning: _mark, ...unmarked } = card;
    if (filterLocalCards([unmarked as Doc<"cards">], options).length === 0) {
      ids.add(card._id);
    }
  }
  return ids;
}
