import "server-only";
import { api } from "@teak/convex";
import { fetchQuery } from "convex/nextjs";
import { getFunctionName } from "convex/server";
import { convexToJson, type Value } from "convex/values";
import {
  type FirstLoadQuery,
  firstLoadQueries,
  type QuerySeed,
  querySeedKey,
} from "./firstLoadQueries";
import type { FolderSummary } from "./folders";
import { folderIdForPath } from "./folders";
import { getConvexUrl } from "./public-env";

// The page waits this long at most for its first queries; whatever hasn't
// answered by then loads in the browser as before.
export const FIRST_LOAD_SEED_BUDGET_MS = 600;

const LIST_FOLDERS = getFunctionName(api.folders.listFolders);

/**
 * Runs the queries the page at `href` shows first with the visitor's access
 * token, so the server can render real content in the first paint. The token
 * stays on the server: only the results go to the page.
 */
export async function fetchFirstLoadSeeds(
  href: string,
  token: string,
  budgetMs = FIRST_LOAD_SEED_BUDGET_MS
): Promise<QuerySeed[]> {
  const url = new URL(href);
  const seeds: QuerySeed[] = [];
  const started = new Set<string>();
  const seed = async ({ query, args }: FirstLoadQuery) => {
    const name = getFunctionName(query);
    const argsJson = convexToJson(args as Value);
    const key = querySeedKey(name, argsJson);
    if (started.has(key)) {
      return;
    }
    started.add(key);
    try {
      const value = await fetchQuery(query, args, {
        token,
        url: getConvexUrl(),
      });
      seeds.push({ name, args: argsJson, value: convexToJson(value) });
      return value;
    } catch {
      // The browser runs it live instead.
    }
  };
  const queries = firstLoadQueries(url);
  const pending = queries.map(seed);
  if (folderIdForPath(url.pathname)) {
    // A manual folder's cards are known only once the folders say its kind.
    const folders = pending[
      queries.findIndex(({ query }) => getFunctionName(query) === LIST_FOLDERS)
    ] as Promise<FolderSummary[] | undefined>;
    pending.push(
      folders.then(async (loaded) => {
        if (loaded) {
          await Promise.all(
            firstLoadQueries(url, { folders: loaded }).map(seed)
          );
        }
      })
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending),
    new Promise((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    }),
  ]);
  clearTimeout(timer);
  return seeds.slice();
}
