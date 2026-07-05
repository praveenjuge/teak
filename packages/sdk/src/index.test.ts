import { describe, expect, test } from "bun:test";
import {
  buildCardsSearchParams,
  createTeakClient,
  parseTags,
  type TeakApiError,
} from ".";

describe("@teak/sdk", () => {
  test("normalizes search params", () => {
    expect(
      buildCardsSearchParams({
        limit: 500,
        query: " hi ",
        sort: "oldest",
        tag: "ux",
      })
    ).toBe("q=hi&tag=ux&sort=oldest&limit=100");
  });

  test("deduplicates tags", () => {
    expect(parseTags("a, b,a,,")).toEqual(["a", "b"]);
  });

  test("refreshes once on unauthorized responses", async () => {
    const calls: string[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: {
        getAccessToken: () => "old",
        onUnauthorized: () => "new",
      },
      fetch: ((_url, init) => {
        calls.push(new Headers(init?.headers).get("authorization") || "");
        return calls.length === 1
          ? new Response(
              JSON.stringify({ code: "UNAUTHORIZED", error: "Expired" }),
              { status: 401 }
            )
          : new Response(JSON.stringify({ items: [] }), { status: 200 });
      }) as typeof fetch,
    });
    await expect(client.tags.list()).resolves.toEqual({ items: [] });
    expect(calls).toEqual(["Bearer old", "Bearer old"]);
  });

  test("maps request timeouts", async () => {
    const client = createTeakClient({
      baseUrl: "https://api.example",
      timeoutMs: 1,
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })) as typeof fetch,
    });
    await expect(client.tags.list()).rejects.toMatchObject({
      code: "TIMEOUT",
    } satisfies Partial<TeakApiError>);
  });
});
