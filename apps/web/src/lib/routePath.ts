/**
 * A pathname as a route matches it: the router treats `/settings/` (and
 * `/settings//`) as `/settings`, so checks on a raw path drop trailing
 * slashes the same way; `/` stays.
 */
export function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}
