import type { Doc } from "@teak/convex/_generated/dataModel";

type EditableCard = Pick<
  Doc<"cards">,
  "aiTags" | "content" | "notes" | "tags" | "type"
>;

export interface CardEditDraft {
  aiTags: string[];
  /** Undefined for card types whose content isn't editable. */
  content?: string;
  notes: string;
  tags: string[];
}

export type CardFieldChange =
  | { field: "content"; value: string }
  | { field: "notes"; value: string | null }
  | { field: "tags"; value: string[] }
  | { field: "removeAiTag"; tagToRemove: string };

/** Tags are stored trimmed and lowercase, like the web's tag manager. */
export const normalizeTag = (value: string): string =>
  value.trim().toLowerCase();

const sameList = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, i) => value === right[i]);

/** The field updates that turn the card into the draft, in save order. */
export const buildCardEdit = (
  card: EditableCard,
  draft: CardEditDraft
): { changes: CardFieldChange[]; hasChanges: boolean } => {
  const changes: CardFieldChange[] = [];
  if (draft.content !== undefined && draft.content !== (card.content ?? "")) {
    changes.push({ field: "content", value: draft.content });
  }
  const notes = draft.notes.trim();
  if (notes !== (card.notes ?? "").trim()) {
    changes.push({ field: "notes", value: notes || null });
  }
  if (!sameList(draft.tags, card.tags ?? [])) {
    changes.push({ field: "tags", value: draft.tags });
  }
  for (const tag of card.aiTags ?? []) {
    if (!draft.aiTags.includes(tag)) {
      changes.push({ field: "removeAiTag", tagToRemove: tag });
    }
  }
  return { changes, hasChanges: changes.length > 0 };
};
