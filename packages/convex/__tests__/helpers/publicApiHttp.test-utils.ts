import { mock } from "bun:test";
import type { ActionCtx } from "../../_generated/server";
import { handlePublicApiRequest } from "../../publicApi/http/router";
import { withMappedOwner } from "./session.test-utils";

export const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(withMappedOwner(ctx), request);
};

type QueryValue = boolean | number | string | readonly string[] | undefined;

/** A REST request as a test writes it: method, path, query, headers, body. */
export interface ApiRequest {
  body?: unknown;
  headers?: HeadersInit;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
  query?: Record<string, QueryValue>;
}

export const apiRequest = (request: ApiRequest): Request => {
  const url = new URL(request.path, "https://teak.test");
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry);
      }
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  const headers = new Headers(request.headers);
  if (request.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, {
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    headers,
    method: request.method,
  });
};

/** Sends a request through the API router, as `/v1/` routes do. */
export const callPublicApi = (ctx: ActionCtx, request: ApiRequest) =>
  handlePublicApiRequest(ctx, apiRequest(request));

export const buildAuthorizedMutationMock = () =>
  mock().mockResolvedValueOnce({
    keyId: "key_1",
    userId: "user_1",
    access: "full_access",
    source: "component",
    rateLimitKey: "component:key_1",
    rateLimit: { ok: true, retryAt: undefined },
  });
