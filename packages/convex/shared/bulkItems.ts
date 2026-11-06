/**
 * What a bulk card item lacks for its operation, in the API's words. The
 * CLI checks items with this before sending them (`cards bulk --dry-run`),
 * and the API's bulk handler gives the same answers; the API still has the
 * last word on what only it can check (a card that doesn't exist, a URL it
 * won't fetch, tag rules).
 */
import type { BulkCardOperation } from "./publicApiContract";

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "";

/** The problem with one bulk item, or null when its shape is right. */
export const bulkItemProblem = (
  operation: BulkCardOperation,
  item: unknown
): string | null => {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return "Each bulk item must be an object";
  }
  const payload = item as Record<string, unknown>;
  if (operation === "create") {
    // Empty content is fine on an explicit text card.
    const content =
      typeof payload.content === "string" ? payload.content : undefined;
    const hasUrl = nonEmptyString(payload.url);
    const missing =
      (content === undefined && !hasUrl) ||
      (payload.cardType !== "text" && !hasUrl && !content?.trim());
    return missing ? "Each create item must include `content` or `url`" : null;
  }
  if (!nonEmptyString(payload.cardId)) {
    return "Each bulk item must include a valid `cardId`";
  }
  if (operation === "favorite" && typeof payload.isFavorited !== "boolean") {
    return "Each favorite item must include `isFavorited` as a boolean";
  }
  if (
    operation === "update" &&
    !(
      typeof payload.content === "string" ||
      typeof payload.url === "string" ||
      typeof payload.notes === "string" ||
      payload.notes === null ||
      Array.isArray(payload.tags)
    )
  ) {
    return "Each update item must include content, url, notes or tags";
  }
  if (
    (operation === "addTags" || operation === "removeTags") &&
    !(Array.isArray(payload.tags) && payload.tags.some(nonEmptyString))
  ) {
    return "Name at least one tag";
  }
  return null;
};
