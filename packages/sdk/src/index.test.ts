import { describe, expect, test } from "bun:test";
import {
  buildCardsSearchParams,
  createTeakClient,
  type Folder,
  parseTags,
  type TagOperation,
  type TeakApiError,
} from "./index";

describe("teak-sdk", () => {
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

  test("asks for best-match order", () => {
    expect(buildCardsSearchParams({ query: "x", sort: "relevance" })).toBe(
      "q=x&sort=relevance&limit=50"
    );
    expect(buildCardsSearchParams({ query: "x", sort: "newest" })).toBe(
      "q=x&limit=50"
    );
  });

  test("asks for a card's similar cards", async () => {
    const urls: string[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      fetch: ((input: unknown) => {
        urls.push(String(input));
        return Promise.resolve(
          Response.json({
            items: [],
            pageInfo: { hasMore: false, nextCursor: null },
            similarity: "pending",
          })
        );
      }) as typeof fetch,
      tokenProvider: { getAccessToken: () => "token" },
    });
    const page = await client.cards.similar("card_1", { type: "image" });
    expect(page.similarity).toBe("pending");
    expect(urls[0]).toBe(
      "https://api.example/v1/cards?type=image&include=content%2Cmetadata&similarTo=card_1&limit=50"
    );
  });

  test("reads a card's links and backlinks, defaulting to none", async () => {
    const bodies = [
      {
        backlinks: [{ id: "card_3", missing: false, title: "C", type: "text" }],
        backlinksTruncated: true,
        content: "",
        id: "card_1",
        links: [{ id: "card_2", missing: true, title: null, type: null }],
        linksTruncated: false,
      },
      { content: "", id: "card_1" },
    ];
    const urls: string[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      fetch: ((input: unknown) => {
        urls.push(String(input));
        return Promise.resolve(Response.json(bodies.shift()));
      }) as typeof fetch,
      tokenProvider: { getAccessToken: () => "token" },
    });
    expect(await client.cards.links("card_1")).toEqual({
      backlinks: [{ id: "card_3", missing: false, title: "C", type: "text" }],
      backlinksTruncated: true,
      links: [{ id: "card_2", missing: true, title: null, type: null }],
      linksTruncated: false,
    });
    expect(urls[0]).toBe("https://api.example/v1/cards/card_1");
    expect(await client.cards.links("card_1")).toEqual({
      backlinks: [],
      backlinksTruncated: false,
      links: [],
      linksTruncated: false,
    });
  });

  test("me reads the account's language, including codes newer than this SDK", async () => {
    const profile = (locale: string) => ({
      data: {
        id: "u",
        email: "me@example.org",
        plan: "free",
        cardCount: 1,
        cardLimit: 200,
        locale,
        settingsUrl: "https://app/settings",
      },
    });
    const bodies = [profile("de"), profile("tlh")];
    const urls: string[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      fetch: ((input: unknown) => {
        urls.push(String(input));
        return Promise.resolve(Response.json(bodies.shift()));
      }) as typeof fetch,
      tokenProvider: { getAccessToken: () => "token" },
    });
    expect((await client.me()).locale).toBe("de");
    expect(urls).toEqual(["https://api.example/v1/me"]);
    expect((await client.me()).locale).toBe("tlh");
  });

  test("sends a search mode other than the API's hybrid default", () => {
    expect(buildCardsSearchParams({ query: "nook", mode: "semantic" })).toBe(
      "q=nook&mode=semantic&limit=50"
    );
    expect(buildCardsSearchParams({ query: "nook", mode: "hybrid" })).toBe(
      "q=nook&limit=50"
    );
  });

  test("encodes selected types as repeated query parameters", () => {
    expect(buildCardsSearchParams({ type: ["image", "link"] })).toBe(
      "type=image&type=link&limit=50"
    );
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

  test("times out a response whose body stalls after its headers", async () => {
    let cancelled = false;
    const client = createTeakClient({
      baseUrl: "https://api.example",
      timeoutMs: 5,
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_input: unknown) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"items":'));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status: 200 }
          )
        )) as unknown as typeof fetch,
    });
    const outcome = await Promise.race([
      client.tags.list().then(
        () => "resolved",
        (error: unknown) => error
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve("still waiting"), 1000)
      ),
    ]);
    expect(outcome).toMatchObject({
      code: "TIMEOUT",
    } satisfies Partial<TeakApiError>);
    // The stalled body is cancelled, not left buffering after the timeout.
    expect(cancelled).toBe(true);
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
        return Promise.resolve(
          new Response(null, {
            headers: { ETag: '"upload-etag"' },
            status: 200,
          })
        );
      }) as typeof fetch,
    });

    const uploaded = await client.uploads.putFile(
      "https://upload.example",
      new Uint8Array([1, 2, 3]),
      "image/png"
    );

    expect(seenHeaders).toEqual({
      contentLength: "3",
      contentType: "image/png",
    });
    expect(uploaded).toEqual({ fileEtag: '"upload-etag"' });
  });

  test("parses the backwards-compatible upload response contract", async () => {
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_input: unknown) =>
        Promise.resolve(
          Response.json({
            expiresIn: 600,
            fileKey: "users/u/cards/pending/file/source.tsx",
            maxFileSize: 100 * 1024 * 1024,
            method: "PUT",
            uploadUrl: "https://upload.example",
          })
        )) as unknown as typeof fetch,
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

  test("create reads a re-save: still created, with resaved and the card's savedAt", async () => {
    // A re-save keeps `status: "created"`, which is all `cards.create` checks,
    // so SDKs and CLIs released before re-saves parse it as a plain create.
    const body = {
      appUrl: "https://app.example/?card=card_1",
      card: { createdAt: 1, id: "card_1", savedAt: 2 },
      cardId: "card_1",
      resaved: true,
      status: "created",
      wasArchived: true,
    };
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_input: unknown) =>
        Promise.resolve(Response.json(body))) as typeof fetch,
    });

    const created = await client.cards.create({
      url: "https://example.com/post?utm_source=x",
    });
    expect(created).toEqual(body as typeof created);
    expect(created.resaved).toBe(true);
    expect(created.wasArchived).toBe(true);
    expect(created.card?.savedAt).toBe(2);
  });

  test("create still refuses an answer that isn't created", async () => {
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_input: unknown) =>
        Promise.resolve(
          Response.json({ cardId: "card_1", status: "resaved" })
        )) as typeof fetch,
    });

    await expect(
      client.cards.create({ url: "https://example.com" })
    ).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });

  test("create sends a text card's sourceUrl and sourceTitle", async () => {
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
      cardType: "text",
      content: "A quote",
      sourceTitle: "An essay",
      sourceUrl: "https://example.com/essay",
    });

    expect(requestBody).toEqual({
      cardType: "text",
      content: "A quote",
      sourceTitle: "An essay",
      sourceUrl: "https://example.com/essay",
    });
  });

  test("search uses the canonical list transport with full-card fields", async () => {
    const seenUrls: string[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url) => {
        seenUrls.push(String(url));
        return Promise.resolve(
          Response.json({
            items: [{ id: "card_1", content: "hello" }],
            pageInfo: { hasMore: false, nextCursor: null },
          })
        );
      }) as typeof fetch,
    });

    const result = await client.cards.search({ query: "hello", limit: 10 });

    expect(seenUrls).toEqual([
      "https://api.example/v1/cards?q=hello&include=content%2Cmetadata&limit=10",
    ]);
    expect(result).toEqual<unknown>({
      items: [{ id: "card_1", content: "hello" }],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  });

  test("favorites forces the favorited filter on the canonical transport", async () => {
    const seenUrls: string[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url) => {
        seenUrls.push(String(url));
        return Promise.resolve(
          Response.json({
            items: [],
            pageInfo: { hasMore: true, nextCursor: "cursor_1" },
          })
        );
      }) as typeof fetch,
    });

    const result = await client.cards.favorites({ limit: 5 });

    expect(seenUrls).toEqual([
      "https://api.example/v1/cards?include=content%2Cmetadata&favorited=true&limit=5",
    ]);
    expect(result).toEqual({
      items: [],
      pageInfo: { hasMore: true, nextCursor: "cursor_1" },
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

  test("sends Trash and visual filters as repeatable query parameters", () => {
    expect(
      buildCardsSearchParams({
        hex: ["#112233"],
        hue: ["blue", "teal"],
        style: "minimal",
        trashed: true,
        type: ["image", "link"],
      })
    ).toBe(
      "type=image&type=link&style=minimal&hue=blue&hue=teal&hex=%23112233&trashed=true&limit=50"
    );
  });

  const recordingClient = (
    respond: () => Response = () => new Response(null, { status: 204 })
  ) => {
    const seen: Array<{ headers: Headers; method: string; url: string }> = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        seen.push({
          headers: new Headers(init?.headers),
          method: String(init?.method),
          url: String(url),
        });
        return Promise.resolve(respond());
      }) as typeof fetch,
    });
    return { client, seen };
  };

  test("search keeps a caller's include instead of forcing the default", async () => {
    const { client, seen } = recordingClient(() =>
      Response.json({
        items: [],
        pageInfo: { hasMore: false, nextCursor: null },
      })
    );
    await client.cards.search({ query: "x", include: "content,processing" });
    expect(seen[0]?.url).toBe(
      "https://api.example/v1/cards?q=x&include=content%2Cprocessing&limit=50"
    );
  });

  test("restores, deletes permanently, and only then skips Trash", async () => {
    const { client, seen } = recordingClient();
    await client.cards.restore("c1");
    await client.cards.delete("c1");
    await client.cards.delete("c1", { permanent: true });
    expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST https://api.example/v1/cards/c1/restore",
      "DELETE https://api.example/v1/cards/c1",
      "DELETE https://api.example/v1/cards/c1?permanent=true",
    ]);
  });

  test("archives through a card PATCH and lists archived cards on request", async () => {
    const sent: Array<{ body: unknown; method: string; url: string }> = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        sent.push({
          body: JSON.parse(String(init?.body)),
          method: String(init?.method),
          url: String(url),
        });
        return Promise.resolve(
          Response.json({ id: "c1", content: "x", isArchived: true })
        );
      }) as typeof fetch,
    });
    const archived = await client.cards.setArchived("c1", true);
    expect(archived.isArchived).toBe(true);
    expect(sent).toEqual([
      {
        body: { isArchived: true },
        method: "PATCH",
        url: "https://api.example/v1/cards/c1",
      },
    ]);
    expect(buildCardsSearchParams({ archived: "only" })).toBe(
      "archived=only&limit=50"
    );
    expect(buildCardsSearchParams({ archived: "exclude" })).toBe("limit=50");
  });

  test("marks a link done with POST and not done with DELETE", async () => {
    const sent: Array<{ method: string; url: string }> = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        sent.push({ method: String(init?.method), url: String(url) });
        return Promise.resolve(
          Response.json({ id: "c1", content: "x", completedAt: 5 })
        );
      }) as typeof fetch,
    });
    expect((await client.cards.setDone("c1", true)).completedAt).toBe(5);
    await client.cards.setDone("c1", false);
    expect(sent).toEqual([
      { method: "POST", url: "https://api.example/v1/cards/c1/done" },
      { method: "DELETE", url: "https://api.example/v1/cards/c1/done" },
    ]);
  });

  test("saves a paper's PDF with POST /save-pdf", async () => {
    const sent: Array<{ method: string; url: string }> = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        sent.push({ method: String(init?.method), url: String(url) });
        return Promise.resolve(
          Response.json({ cardId: "doc1", created: true }, { status: 201 })
        );
      }) as typeof fetch,
    });
    expect(await client.cards.savePdf("c1")).toEqual({
      cardId: "doc1",
      created: true,
    });
    expect(sent).toEqual([
      { method: "POST", url: "https://api.example/v1/cards/c1/save-pdf" },
    ]);
  });

  test("a save already running is an IN_PROGRESS error", async () => {
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((_input: unknown) =>
        Promise.resolve(
          Response.json(
            { code: "IN_PROGRESS", error: "This PDF is already being saved." },
            { status: 409 }
          )
        )) as unknown as typeof fetch,
    });
    await expect(client.cards.savePdf("c1")).rejects.toMatchObject({
      code: "IN_PROGRESS",
    });
  });

  test("starts tag changes and polls their progress", async () => {
    const sent: Array<{ body: unknown; method: string; url: string }> = [];
    const operation: TagOperation = {
      id: "op1",
      kind: "rename",
      from: "design",
      to: "Design Systems",
      status: "running",
      total: 3,
      processed: 0,
      changed: 0,
      error: null,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
    };
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        const method = String(init?.method);
        sent.push({
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          method,
          url: String(url),
        });
        if (String(url).endsWith("/v1/tags/delete")) {
          return Promise.resolve(
            Response.json(
              {
                code: "TAG_OPERATION_RUNNING",
                error: "Another tag change is still running",
              },
              { status: 409 }
            )
          );
        }
        return Promise.resolve(
          Response.json(
            method === "POST"
              ? { operationId: "op1", ...operation }
              : operation,
            { status: method === "POST" ? 202 : 200 }
          )
        );
      }) as typeof fetch,
    });

    expect(await client.tags.rename("Design", "Design Systems")).toEqual(
      operation
    );
    await client.tags.merge("ux", "research");
    expect((await client.tags.operation("op 1")).status).toBe("running");
    const refused = await client.tags.delete("old").catch((error) => error);
    expect(refused).toMatchObject({
      code: "TAG_OPERATION_RUNNING",
      status: 409,
    });
    expect(sent.map(({ method, url, body }) => [method, url, body])).toEqual([
      [
        "POST",
        "https://api.example/v1/tags/rename",
        { from: "Design", to: "Design Systems" },
      ],
      [
        "POST",
        "https://api.example/v1/tags/merge",
        { from: "ux", into: "research" },
      ],
      ["GET", "https://api.example/v1/tags/operations/op%201", undefined],
      ["POST", "https://api.example/v1/tags/delete", { tag: "old" }],
    ]);
  });

  test("manages folders and their cards", async () => {
    const sent: Array<{ body: unknown; method: string; url: string }> = [];
    const folder: Folder = {
      id: "f1",
      name: "Reading",
      color: "blue",
      kind: "manual",
      query: null,
      cardCount: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        const method = String(init?.method);
        sent.push({
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          method,
          url: String(url),
        });
        if (String(url).endsWith("/cards")) {
          return Promise.resolve(
            Response.json({ updatedIds: ["c1"], failedIds: [] })
          );
        }
        if (method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          Response.json(
            method === "GET" && String(url).endsWith("/v1/folders")
              ? { items: [folder] }
              : folder
          )
        );
      }) as typeof fetch,
    });

    expect((await client.folders.list()).items).toEqual([folder]);
    expect((await client.folders.create({ name: "Reading" })).id).toBe("f1");
    await client.folders.update("f1", { color: null });
    expect(await client.folders.addCards("f1", ["c1"])).toEqual({
      updatedIds: ["c1"],
      failedIds: [],
      folderLimitIds: [],
    });
    await client.folders.removeCards("f1", ["c1"]);
    expect(await client.folders.delete("f1")).toBeNull();
    expect(sent.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["GET", "https://api.example/v1/folders", undefined],
      ["POST", "https://api.example/v1/folders", { name: "Reading" }],
      ["PATCH", "https://api.example/v1/folders/f1", { color: null }],
      ["POST", "https://api.example/v1/folders/f1/cards", { cardIds: ["c1"] }],
      [
        "DELETE",
        "https://api.example/v1/folders/f1/cards",
        { cardIds: ["c1"] },
      ],
      ["DELETE", "https://api.example/v1/folders/f1", undefined],
    ]);
    expect(buildCardsSearchParams({ folder: " f1 " })).toBe(
      "folder=f1&limit=50"
    );
  });

  test("sends an idempotency key only when one is given", async () => {
    const { client, seen } = recordingClient(() =>
      Response.json({ appUrl: "https://app/", cardId: "c1", status: "created" })
    );
    await client.cards.create({ content: "a" }, { idempotencyKey: "step-1" });
    await client.cards.create({ content: "b" });
    expect(seen[0]?.headers.get("Idempotency-Key")).toBe("step-1");
    expect(seen[1]?.headers.has("Idempotency-Key")).toBe(false);
  });

  test("reports the request ID from the response header on errors", async () => {
    const { client } = recordingClient(
      () =>
        new Response(
          JSON.stringify({ code: "NOT_FOUND", error: "Card not found" }),
          {
            headers: { "X-Request-Id": "req_123" },
            status: 404,
          }
        )
    );
    const error = (await client.cards
      .get("missing")
      .catch((e) => e)) as TeakApiError;
    expect(error.code).toBe("NOT_FOUND");
    expect(error.requestId).toBe("req_123");
  });
});

describe("link images", () => {
  const recording = () => {
    const calls: { body: unknown; method: string; url: string }[] = [];
    const client = createTeakClient({
      baseUrl: "https://api.example",
      tokenProvider: { getAccessToken: () => "token" },
      fetch: ((url, init) => {
        calls.push({
          body: init?.body,
          method: init?.method ?? "GET",
          url: String(url),
        });
        const { pathname } = new URL(String(url));
        if (pathname.endsWith("/thumbnail/upload")) {
          return Promise.resolve(
            Response.json({
              expiresIn: 600,
              fileKey: "pending/key",
              maxFileSize: 20 * 1024 * 1024,
              method: "PUT",
              uploadUrl: "https://files.example/__upload/v1/pending",
            })
          );
        }
        if (pathname.startsWith("/__upload")) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return Promise.resolve(
          Response.json({
            content: "https://example.com",
            id: "card_1",
            thumbnailOverridden: init?.method === "PUT",
          })
        );
      }) as typeof fetch,
    });
    return { calls, client };
  };

  test("setThumbnail uploads the bytes, then applies them", async () => {
    const { calls, client } = recording();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const card = await client.cards.setThumbnail("card_1", bytes, "image/png");
    expect(card.thumbnailOverridden).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://api.example/v1/cards/card_1/thumbnail/upload",
      "PUT https://files.example/__upload/v1/pending",
      "PUT https://api.example/v1/cards/card_1/thumbnail",
    ]);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      fileSize: 4,
      mimeType: "image/png",
    });
    expect(calls[1]?.body).toBe(bytes);
    expect(JSON.parse(String(calls[2]?.body))).toEqual({
      fileKey: "pending/key",
    });
  });

  test("setThumbnail applies a finished upload by its fileKey", async () => {
    const { calls, client } = recording();
    await client.cards.setThumbnail("card_1", { fileKey: "pending/key" });
    expect(calls.map((call) => call.method)).toEqual(["PUT"]);
  });

  test("setThumbnail needs a MIME type for bytes", async () => {
    const { calls, client } = recording();
    await expect(
      client.cards.setThumbnail("card_1", new Uint8Array([1]))
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(calls).toEqual([]);
  });

  test("resetThumbnail deletes the chosen image", async () => {
    const { calls, client } = recording();
    await client.cards.resetThumbnail("card_1");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE https://api.example/v1/cards/card_1/thumbnail",
    ]);
  });
});
