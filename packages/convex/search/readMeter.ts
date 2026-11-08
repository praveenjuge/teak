import type { QueryCtx } from "../_generated/server";
import { parseSearchQuery } from "../shared/search/qualifiers";

/**
 * Temporary: measures what each branch of the paginated card search reads,
 * so the decision to move keyword search to the Core Worker rests on
 * production numbers (`bunx convex logs --prod | grep search/readMeter`).
 * It counts the documents the database hands back (`returnedDocs`,
 * `returnedBytes`), not rows a filter skipped, so it shows each branch's
 * share; the Convex usage page stays the source for total I/O. Remove it
 * once that decision is made.
 */

export type SearchBranch =
  | "folder"
  | "like"
  | "list"
  | "shuffle"
  | "tag"
  | "text";

/**
 * The branch the search handler takes, from the same parse it runs: free
 * words or `text:` read the search indexes, `like:` and `mood:` read the
 * meaning ranking, and qualifiers alone (`tag:ui`) read ordinary indexes.
 */
interface BranchArgs {
  folderId?: string;
  folderQuery?: string;
  searchQuery?: string;
  sort?: string;
  tag?: string;
}

export const searchBranch = (args: BranchArgs): SearchBranch => {
  const parsed = parseSearchQuery(args.searchQuery ?? "");
  if (parsed.similarity) {
    return "like";
  }
  if (parsed.text.trim() || parsed.ocrTexts.length > 0) {
    return "text";
  }
  if (args.tag || parsed.tags.length > 0) {
    return "tag";
  }
  if (args.folderId || args.folderQuery || parsed.folders.length > 0) {
    return "folder";
  }
  return args.sort === "shuffle" ? "shuffle" : "list";
};

interface Meter {
  bytes: number;
  docs: number;
}

// Convex documents may hold int64 values, which JSON.stringify refuses.
const sizeReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

const countDoc = (meter: Meter, doc: unknown) => {
  if (doc && typeof doc === "object") {
    meter.docs += 1;
    try {
      meter.bytes += JSON.stringify(doc, sizeReplacer).length;
    } catch {
      // Sizing is best effort; it never fails the search.
    }
  }
};

const countResult = (meter: Meter, value: unknown) => {
  if (Array.isArray(value)) {
    for (const doc of value) {
      countDoc(meter, doc);
    }
  } else if (value && typeof value === "object") {
    const { page } = value as { page?: unknown };
    if (Array.isArray(page)) {
      countResult(meter, page);
    } else if ("_id" in value) {
      countDoc(meter, value);
    }
  }
};

const isPromise = (value: unknown): value is Promise<unknown> =>
  value instanceof Promise;

/** Wraps a database reader so every document it hands back is counted. */
const metered = <T extends object>(target: T, meter: Meter): T =>
  new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (typeof value !== "function") {
        return value;
      }
      if (property === Symbol.asyncIterator) {
        return () => {
          const iterator = (value as () => AsyncIterator<unknown>).call(object);
          const counted: AsyncIterableIterator<unknown> = {
            next: async () => {
              const step = await iterator.next();
              if (!step.done) {
                countDoc(meter, step.value);
              }
              return step;
            },
            [Symbol.asyncIterator]: () => counted,
          };
          return counted;
        };
      }
      return (...args: unknown[]) => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(
          object,
          args
        );
        if (isPromise(result)) {
          return result.then((resolved) => {
            countResult(meter, resolved);
            return resolved;
          });
        }
        return result && typeof result === "object"
          ? metered(result, meter)
          : result;
      };
    },
  });

/** Reports the search after a smart folder's saved query is merged in. */
export type ExpandedSearchReport = (
  searchQuery: string,
  folderId: string | undefined
) => void;

/**
 * Runs `read` with a database that counts what it reads, then logs one line
 * with the branch, the documents and their approximate size. The branch
 * starts from the arguments and is set again from the search `read`
 * reports once a smart folder's saved query is merged in, since only then
 * does the handler know which branch it takes.
 */
export const withReadMeter = async <T>(
  ctx: QueryCtx,
  args: BranchArgs,
  read: (ctx: QueryCtx, reportSearch: ExpandedSearchReport) => Promise<T>
): Promise<T> => {
  const meter: Meter = { bytes: 0, docs: 0 };
  let branch = searchBranch(args);
  const reportSearch: ExpandedSearchReport = (searchQuery, folderId) => {
    branch = searchBranch({
      searchQuery,
      folderId,
      sort: args.sort,
      tag: args.tag,
    });
  };
  try {
    return await read(
      ctx.db ? { ...ctx, db: metered(ctx.db, meter) } : ctx,
      reportSearch
    );
  } finally {
    console.log(
      "[search/readMeter]",
      JSON.stringify({
        branch,
        returnedDocs: meter.docs,
        returnedBytes: meter.bytes,
      })
    );
  }
};
