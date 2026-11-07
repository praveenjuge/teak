import { createTeakClient, type TeakClient } from "teak-sdk";

export const TEAK_API = "https://teak.test";

/** Answers one API request by its path and query; null means signed out. */
export type ApiRequest = (
  path: string,
  init?: RequestInit
) => Promise<Response | null>;

/**
 * A real SDK client whose Teak API is `request`: it gets each request's
 * path, query and init, and null answers 401, as for a signed-out user.
 * Requests to other hosts (signed upload URLs) go to `fetchImpl`.
 */
export const apiClient = (
  request: ApiRequest,
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response> = () =>
    Promise.reject(new Error("Unexpected request outside the API"))
): TeakClient =>
  createTeakClient({
    baseUrl: TEAK_API,
    retries: 0,
    tokenProvider: { getAccessToken: () => "token" },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== TEAK_API) {
        return await fetchImpl(input, init);
      }
      return (
        (await request(`${url.pathname}${url.search}`, init)) ??
        new Response(null, { status: 401 })
      );
    }) as typeof fetch,
  });

/** What the API answers for a card, with the fields a test cares about. */
export const apiCard = (fields: Record<string, unknown> = {}) => ({
  aiTags: [],
  appUrl: "https://app.teak.test/?card=card_1",
  content: "",
  createdAt: 1,
  id: "card_1",
  isFavorited: false,
  notes: null,
  tags: [],
  type: "text",
  updatedAt: 1,
  ...fields,
});

/** What the API answers for a signed upload. */
export const apiUpload = (fileKey: string, uploadUrl: string) => ({
  expiresIn: 600,
  fileKey,
  maxFileSize: 100 * 1024 * 1024,
  method: "PUT",
  uploadUrl,
});
