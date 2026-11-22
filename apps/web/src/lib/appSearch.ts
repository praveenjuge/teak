/**
 * The search params every signed-in page reads, kept as the plain strings
 * Teak's URLs carry (router.tsx parses them without JSON).
 */
export type AppSearch = Partial<Record<string, string>>;

/** The signed-in layout's `validateSearch`: strings only. */
export const validateAppSearch = (search: Record<string, unknown>): AppSearch =>
  Object.fromEntries(
    Object.entries(search).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );

/** The same params as `URLSearchParams`, in the order the URL has them. */
export const appSearchParams = (search: AppSearch): URLSearchParams =>
  new URLSearchParams(
    Object.entries(search).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
