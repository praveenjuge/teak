import { SAFE_FETCH_MAX_DURATION_MS } from "@teak/convex/linkMetadata/ssrf";
import {
  CONTAINER_START_ALLOWANCE_MS,
  containerPoolSize,
  postToPool,
} from "./containerPool";

export interface LinkFetcherEnv {
  LINK_FETCHER?: DurableObjectNamespace;
  LINK_FETCHER_INSTANCES?: string;
}

/** Posts JSON to the link fetcher. `timeoutMs` covers reading the response. */
export const postToFetcher = (
  env: LinkFetcherEnv,
  path: string,
  body: unknown,
  random: () => number = Math.random,
  timeoutMs = SAFE_FETCH_MAX_DURATION_MS + CONTAINER_START_ALLOWANCE_MS
): Promise<Response> =>
  postToPool(
    {
      host: "fetcher",
      namespace: env.LINK_FETCHER,
      reasonPrefix: "fetcher_",
      size: containerPoolSize(env.LINK_FETCHER_INSTANCES),
    },
    {
      body: () =>
        Promise.resolve({
          body: JSON.stringify(body),
          contentType: "application/json",
        }),
      path,
      timeoutMs,
    },
    random
  );
