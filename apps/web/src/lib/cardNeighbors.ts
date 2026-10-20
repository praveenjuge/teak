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
