/**
 * A pathname as a route matches it. With the default `trailingSlash: false`,
 * Next.js redirects `/settings/` (and `/settings//`) to `/settings`; `/` stays.
 */
export function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}
