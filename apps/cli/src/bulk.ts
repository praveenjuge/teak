import type { BulkCardsOperation } from "teak-sdk";

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "";

const stringArray = (value: unknown) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * What a bulk item lacks for its operation, in the API's words, or null.
 * This checks the fields each operation needs; the API still has the last
 * word (a card that doesn't exist, a URL it won't fetch).
 */
export const bulkItemProblem = (
  operation: BulkCardsOperation,
  item: unknown
): string | null => {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return "Each bulk item must be an object";
  }
  const payload = item as Record<string, unknown>;
  if (operation === "create") {
    return nonEmptyString(payload.content) || nonEmptyString(payload.url)
      ? null
      : "Each create item must include `content` or `url`";
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
    !(stringArray(payload.tags) && (payload.tags as string[]).length > 0)
  ) {
    return `Each ${operation} item must include \`tags\` as a list of names`;
  }
  return null;
};
