interface TaggedCard {
  tags?: string[];
}

/**
 * The tag list to save after adding `tag`, or null when nothing should be
 * written. A card that left its list before its own read loaded is unknown
 * here, and writing `[tag]` for it would replace every tag it has.
 */
export const tagsAfterAdding = (
  card: TaggedCard | null,
  tag: string
): string[] | null => {
  const value = tag.trim().toLowerCase();
  if (!(card && value) || (card.tags ?? []).includes(value)) {
    return null;
  }
  return [...(card.tags ?? []), value];
};

export const tagsAfterRemoving = (
  card: TaggedCard | null,
  tag: string
): { tags: string[] | undefined } | null => {
  if (!card) {
    return null;
  }
  const kept = (card.tags ?? []).filter((current) => current !== tag);
  return { tags: kept.length > 0 ? kept : undefined };
};
