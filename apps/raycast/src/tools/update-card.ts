import type { Tool } from "@raycast/api";
import { getCardById, updateCard } from "../lib/api";

type Input = {
  /** The Teak card id to update. */
  cardId: string;
  /** Comma-separated tags to add to the card. */
  addTags?: string;
  /** Comma-separated tags to remove, including tags Teak added automatically. */
  removeTags?: string;
  /** Replacement notes. An empty string clears the notes. */
  notes?: string;
};

const clean = (tags: string | undefined) =>
  (tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

/**
 * Add or remove a Teak card's tags, or replace its notes.
 */
export default async function tool(input: Input) {
  const cardId = input.cardId?.trim();
  if (!cardId) {
    throw new Error("cardId is required");
  }
  const addTags = clean(input.addTags).map((tag) => tag.toLowerCase());
  const removeTags = clean(input.removeTags).map((tag) => tag.toLowerCase());
  const isRemoved = (tag: string) => removeTags.includes(tag.toLowerCase());
  if (!(addTags.length || removeTags.length || input.notes !== undefined)) {
    throw new Error("Provide tags to add or remove, or new notes");
  }

  const card = await getCardById(cardId, { interactive: false });
  const tags = Array.from(new Set([...card.tags, ...addTags])).filter(
    (tag) => !isRemoved(tag),
  );
  const removeAiTags = card.aiTags.filter(isRemoved);
  const updated = await updateCard(
    cardId,
    {
      tags,
      ...(removeAiTags.length > 0 ? { removeAiTags } : {}),
      ...(input.notes === undefined
        ? {}
        : { notes: input.notes.trim() ? input.notes.trim() : null }),
    },
    { interactive: false },
  );

  return {
    aiTags: updated.aiTags,
    appUrl: updated.appUrl,
    cardId: updated.id,
    notes: updated.notes,
    tags: updated.tags,
  };
}

export const confirmation: Tool.Confirmation<Input> = (input) => {
  const info: { name: string; value: string }[] = [
    { name: "Card ID", value: input.cardId },
  ];
  if (clean(input.addTags).length) {
    info.push({ name: "Add Tags", value: clean(input.addTags).join(", ") });
  }
  if (clean(input.removeTags).length) {
    info.push({
      name: "Remove Tags",
      value: clean(input.removeTags).join(", "),
    });
  }
  if (input.notes !== undefined) {
    info.push({ name: "Notes", value: input.notes || "(clear)" });
  }
  return Promise.resolve({ info, message: "Update this Teak card?" });
};
