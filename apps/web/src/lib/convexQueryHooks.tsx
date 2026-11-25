import { useHydrated } from "@tanstack/react-router";
import type {
  OptionalRestArgsOrSkip,
  PaginatedQueryReference,
  UsePaginatedQueryResult,
} from "convex/react";
import {
  type BetterOmit,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  getFunctionName,
  type PaginationOptions,
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
  use,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  firstPageArgs,
  type QuerySeed,
  querySeedKey,
} from "./firstLoadQueries";

// Every screen reads Convex through these hooks: the cached hooks from
// convex-helpers, which fall back to the result the server fetched for the
// page (its seed) while the live query is still loading. A query's seed is
// retired the moment its live result arrives, so nothing shows it again.
// While a component hydrates, the hooks render exactly what the server did
// (the seed, or loading), even when the live result is already in: a
// different first render fails hydration, and React then rebuilds the page,
// dropping anything the person had typed into it.

class QuerySeeds {
  readonly #values: Map<string, Value>;
  // Retired seeds stay readable for components still hydrating, which must
  // match the server even after another reader of the same query went live.
  readonly #retired = new Set<string>();

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

  read(key: string, hydrating: boolean) {
    return hydrating || !this.#retired.has(key)
      ? this.#values.get(key)
      : undefined;
  }

  retire(key: string) {
    this.#retired.add(key);
  }
}

const QuerySeedsContext = createContext<QuerySeeds | null>(null);

/**
 * Gives the screens below the page load's seeds. On a page load they arrive
 * as a promise the server streams, so this suspends until they're in; wrap
 * it in a Suspense boundary.
 */
export function QuerySeedsProvider({
  children,
  seeds,
}: {
  children: ReactNode;
  seeds: readonly QuerySeed[] | Promise<readonly QuerySeed[]>;
}) {
  const loaded = seeds instanceof Promise ? use(seeds) : seeds;
  const [store] = useState(() => new QuerySeeds(loaded));
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

function useSeed(key: string | null, liveArrived: boolean, hydrated: boolean) {
  const seeds = useContext(QuerySeedsContext);
  const liveShown = liveArrived && hydrated;
  useEffect(() => {
    if (liveShown && key !== null) {
      seeds?.retire(key);
    }
  }, [key, liveShown, seeds]);
  return liveShown || key === null ? undefined : seeds?.read(key, !hydrated);
}

export function useQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const live = useCachedQuery(query, ...args);
  const hydrated = useHydrated();
  const key = useSeedKey(query, args[0] as Record<string, Value> | "skip");
  const seed = useSeed(key, live !== undefined, hydrated);
  return live === undefined || !hydrated
    ? (seed as FunctionReturnType<Query> | undefined)
    : live;
}

const noLoadMore = () => undefined;

/**
 * A paginated query whose last page may carry a `null` cursor, as Teak's card
 * searches return. The hooks read the cursor only while more pages remain.
 */
type PageQuery = FunctionReference<
  "query",
  "public",
  { paginationOpts: PaginationOptions },
  BetterOmit<PaginationResult<unknown>, "continueCursor"> & {
    continueCursor: string | null;
  }
>;
type PageQueryArgs<Query extends PageQuery> = BetterOmit<
  FunctionArgs<Query>,
  "paginationOpts"
>;
type PageQueryItem<Query extends PageQuery> =
  FunctionReturnType<Query>["page"][number];

export function usePaginatedQuery<Query extends PageQuery>(
  query: Query,
  args: PageQueryArgs<Query> | "skip",
  options: { customPagination?: boolean; initialNumItems: number }
): UsePaginatedQueryResult<PageQueryItem<Query>> {
  const live = useCachedPaginatedQuery(
    query as unknown as PaginatedQueryReference,
    args,
    options
  ) as UsePaginatedQueryResult<PageQueryItem<Query>>;
  const key = useSeedKey(
    query,
    args === "skip"
      ? "skip"
      : (firstPageArgs(
          args as Record<string, Value>,
          options.initialNumItems
        ) as Record<string, Value>)
  );
  const hydrated = useHydrated();
  const firstPage = useSeed(
    key,
    live.status !== "LoadingFirstPage",
    hydrated
  ) as FunctionReturnType<Query> | undefined;
  if (firstPage === undefined) {
    // The server never has a live page: without a seed it rendered loading.
    return hydrated
      ? live
      : ({
          results: [],
          status: "LoadingFirstPage",
          isLoading: true,
          loadMore: noLoadMore,
        } as UsePaginatedQueryResult<PageQueryItem<Query>>);
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
  ) as UsePaginatedQueryResult<PageQueryItem<Query>>;
}
