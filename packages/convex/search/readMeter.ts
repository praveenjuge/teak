import type { QueryCtx } from "../_generated/server";

/**
 * Temporary: measures how much each branch of the paginated card search
 * reads, so the decision to move keyword search to the Core Worker rests on
 * production numbers (`bunx convex logs --prod | grep search/readMeter`).
 * Remove it once that decision is made.
 */

export type SearchBranch =
  | "folder"
  | "like"
  | "list"
  | "shuffle"
  | "tag"
  | "text";

const LIKE_QUERY = /^(like|mood):/i;

export const searchBranch = (args: {
  folderId?: string;
  folderQuery?: string;
  searchQuery?: string;
  sort?: string;
  tag?: string;
}): SearchBranch => {
  const query = args.searchQuery?.trim() ?? "";
  if (LIKE_QUERY.test(query)) {
    return "like";
  }
  if (query) {
    return "text";
  }
  if (args.tag) {
    return "tag";
  }
  if (args.folderId || args.folderQuery) {
    return "folder";
  }
  return args.sort === "shuffle" ? "shuffle" : "list";
};

interface Meter {
  bytes: number;
  docs: number;
}

const countDoc = (meter: Meter, doc: unknown) => {
  if (doc && typeof doc === "object") {
    meter.docs += 1;
    meter.bytes += JSON.stringify(doc).length;
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

/**
 * Runs `read` with a database that counts what it reads, then logs one line
 * with the branch, the documents and their approximate size.
 */
export const withReadMeter = async <T>(
  ctx: QueryCtx,
  branch: SearchBranch,
  read: (ctx: QueryCtx) => Promise<T>
): Promise<T> => {
  const meter: Meter = { bytes: 0, docs: 0 };
  try {
    return await read(ctx.db ? { ...ctx, db: metered(ctx.db, meter) } : ctx);
  } finally {
    console.log("[search/readMeter]", JSON.stringify({ branch, ...meter }));
  }
};
