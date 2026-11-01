import type {
  OptionalRestArgsOrSkip,
  PaginatedQueryArgs,
  PaginatedQueryReference,
  UsePaginatedQueryReturnType,
} from "convex/react";
import {
  type FunctionReference,
  type FunctionReturnType,
  getFunctionName,
  type PaginationResult,
} from "convex/server";
import { convexToJson, jsonToConvex, type Value } from "convex/values";
import {
  usePaginatedQuery as useCachedPaginatedQuery,
  useQuery as useCachedQuery,
} from "convex-helpers/react/cache/hooks";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { type QuerySeed, querySeedKey } from "./firstLoadQueries";

// Every screen reads Convex through these hooks: the cached hooks from
// convex-helpers, which fall back to the result the server fetched for the
// page (its seed) while the live query is still loading. A query's seed is
// retired the moment its live result arrives, so nothing shows it again.

class QuerySeeds {
  readonly #values: Map<string, Value>;

  constructor(seeds: readonly QuerySeed[]) {
    // Decoded once, so a seed keeps one identity across renders.
    this.#values = new Map(
      seeds.map(({ args, name, value }) => [
        querySeedKey(name, args),
        jsonToConvex(value),
      ])
    );
  }

  get empty() {
    return this.#values.size === 0;
  }

  read(key: string) {
    return this.#values.get(key);
  }

  retire(key: string) {
    this.#values.delete(key);
  }
}

const QuerySeedsContext = createContext<QuerySeeds | null>(null);

export function QuerySeedsProvider({
  children,
  seeds,
}: {
  children: ReactNode;
  seeds: readonly QuerySeed[];
}) {
  const [store] = useState(() => new QuerySeeds(seeds));
  return (
    <QuerySeedsContext.Provider value={store}>
      {children}
    </QuerySeedsContext.Provider>
  );
}

function useSeedKey(
  query: FunctionReference<"query">,
  args: Record<string, Value> | "skip" | undefined
) {
  const seeds = useContext(QuerySeedsContext);
  if (!seeds || seeds.empty || args === "skip") {
    return null;
  }
  return querySeedKey(getFunctionName(query), convexToJson(args ?? {}));
}

function useSeed(key: string | null, liveArrived: boolean) {
  const seeds = useContext(QuerySeedsContext);
  useEffect(() => {
    if (liveArrived && key !== null) {
      seeds?.retire(key);
    }
  }, [key, liveArrived, seeds]);
  return liveArrived || key === null ? undefined : seeds?.read(key);
}

export function useQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const live = useCachedQuery(query, ...args);
  const key = useSeedKey(query, args[0] as Record<string, Value> | "skip");
  const seed = useSeed(key, live !== undefined);
  return live === undefined
    ? (seed as FunctionReturnType<Query> | undefined)
    : live;
}

const noLoadMore = () => undefined;

export function usePaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query> | "skip",
  options: { customPagination?: boolean; initialNumItems: number }
): UsePaginatedQueryReturnType<Query> {
  const live = useCachedPaginatedQuery(query, args, options);
  // The first page exactly as the cached hook asks for it: its id is always 0.
  const key = useSeedKey(
    query,
    args === "skip"
      ? "skip"
      : {
          ...(args as Record<string, Value>),
          paginationOpts: {
            cursor: null,
            id: 0,
            numItems: options.initialNumItems,
          },
        }
  );
  const firstPage = useSeed(key, live.status !== "LoadingFirstPage") as
    | PaginationResult<UsePaginatedQueryReturnType<Query>["results"][number]>
    | undefined;
  if (firstPage === undefined) {
    return live;
  }
  // More pages load once the live query has the first one.
  return (
    firstPage.isDone
      ? {
          results: firstPage.page,
          status: "Exhausted",
          isLoading: false,
          loadMore: noLoadMore,
        }
      : {
          results: firstPage.page,
          status: "LoadingMore",
          isLoading: true,
          loadMore: noLoadMore,
        }
  ) as UsePaginatedQueryReturnType<Query>;
}
