import { describe, expect, test } from "bun:test";
import {
  buildCardsSearchParams,
  createTeakClient,
  parseTags,
  type TeakApiError,
} from "../client/sdk";

describe("@teak/convex/sdk", () => {
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
        return Promise.resolve(
          calls.length === 1
            ? new Response(
                JSON.stringify({ code: "UNAUTHORIZED", error: "Expired" }),
                { status: 401 }
              )
            : new Response(JSON.stringify({ items: [] }), { status: 200 })
        );
      }) as typeof fetch,
    });
    await expect(client.tags.list()).resolves.toEqual({ items: [] });
    expect(calls).toEqual(["Bearer old", "Bearer new"]);
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

  test("sends direct upload content length when known", async () => {
    const seenHeaders: Record<string, string | null> = {};
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_url, init) => {
        const headers = new Headers(init?.headers);
        seenHeaders.contentLength = headers.get("content-length");
        seenHeaders.contentType = headers.get("content-type");
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch,
    });

    await client.uploads.putFile(
      "https://upload.example",
      new Uint8Array([1, 2, 3]),
      "image/png"
    );

    expect(seenHeaders).toEqual({
      contentLength: "3",
      contentType: "image/png",
    });
  });

  test("parses the backwards-compatible upload response contract", async () => {
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: (() =>
        Promise.resolve(
          Response.json({
            expiresIn: 600,
            fileKey: "users/u/cards/pending/file/source.tsx",
            maxFileSize: 100 * 1024 * 1024,
            method: "PUT",
            uploadUrl: "https://upload.example",
          })
        )) as typeof fetch,
    });

    await expect(
      client.uploads.create({
        fileName: "source.tsx",
        fileSize: 12,
        mimeType: "text/tsx",
      })
    ).resolves.toMatchObject({ method: "PUT", maxFileSize: 104_857_600 });
  });

  test("sends uploaded-file creation without a cardType", async () => {
    let requestBody: unknown;
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Promise.resolve(
          Response.json({
            appUrl: "https://app.example/?card=card_1",
            cardId: "card_1",
            status: "created",
          })
        );
      }) as typeof fetch,
    });

    await client.cards.create({
      fileKey: "users/u/cards/pending/file/readme.md",
      fileName: "readme.md",
      fileSize: 12,
      mimeType: "text/markdown",
    });

    expect(requestBody).toEqual({
      fileKey: "users/u/cards/pending/file/readme.md",
      fileName: "readme.md",
      fileSize: 12,
      mimeType: "text/markdown",
    });
  });

  test("sends explicit raw Markdown without changing bytes", async () => {
    let requestBody: any;
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Promise.resolve(
          Response.json({
            appUrl: "https://app.example/?card=card_text",
            cardId: "card_text",
            status: "created",
          })
        );
      }) as typeof fetch,
    });
    const content = "\uFEFF  # SDK\r\n\r\nBody  \n";

    await client.cards.create({ cardType: "text", content });

    expect(requestBody).toEqual({ cardType: "text", content });
  });
});
