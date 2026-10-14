/**
 * The cards before and after the open one, in the order the grid lists them,
 * for the card dialog's previous and next. Undefined at either end, and both
 * undefined when the open card isn't in the list.
 */
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
