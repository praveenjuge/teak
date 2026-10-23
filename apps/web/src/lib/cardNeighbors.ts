export function getAdjacentCardIds(
  ids: readonly string[],
  currentId: string | null
): { next?: string; previous?: string } {
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index === -1) {
    return {};
  }
  return {
    previous: index > 0 ? ids[index - 1] : undefined,
    next: index < ids.length - 1 ? ids[index + 1] : undefined,
  };
}

/**
 * The open card's neighbours in `ids`. An edit can take the open card out of
 * the view (unfavoriting it in Favorites, removing the tag a tag view shows),
 * and then its neighbours come from `lastIds`, the last list that held it:
 * the nearest cards on either side that `ids` still has.
 */
export function getAdjacentCardIdsKeepingPlace(
  ids: readonly string[],
  lastIds: readonly string[] | undefined,
  currentId: string | null
): { next?: string; previous?: string } {
  if (!(currentId && lastIds) || ids.includes(currentId)) {
    return getAdjacentCardIds(ids, currentId);
  }
  const index = lastIds.indexOf(currentId);
  if (index === -1) {
    return {};
  }
  const present = new Set(ids);
  return {
    previous: lastIds.slice(0, index).findLast((id) => present.has(id)),
    next: lastIds.slice(index + 1).find((id) => present.has(id)),
  };
}
