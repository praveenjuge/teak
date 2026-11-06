import { describe, expect, test } from "bun:test";
import { TAG_OPERATION_STALL_MS } from "@teak/convex/shared/tags";
import {
  createTeakClient,
  type TagOperation,
  type TeakApiError,
  waitFor,
} from "./index";

type Route = (request: Request) => Response | Promise<Response>;

const clientFor = (routes: Record<string, Route>, seen: string[] = []) =>
  createTeakClient({
    baseUrl: "https://api.example",
    retries: 0,
    tokenProvider: { getAccessToken: () => "token" },
    fetch: ((input: string, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const key = `${request.method} ${url.origin === "https://api.example" ? url.pathname : url.href}`;
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      seen.push(`${key}${url.search}`);
      const route = routes[key];
      return route
        ? Promise.resolve(route(request))
        : Promise.reject(new Error(`no route for ${key}`));
    }) as typeof fetch,
  });

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as TeakApiError
  );

describe("cards.createFromFile", () => {
  const uploadRoutes = (bodies: unknown[]): Record<string, Route> => ({
    "POST /v1/uploads": async (request) => {
      bodies.push(await request.json());
      return Response.json({
        expiresIn: 60,
        fileKey: "uploads/1",
        maxFileSize: 100,
        method: "PUT",
        uploadUrl: "https://files.example/put/1",
      });
    },
    "PUT https://files.example/put/1": () =>
      new Response(null, { headers: { etag: '"e1"' } }),
    "POST /v1/cards": async (request) => {
      bodies.push(await request.json());
      return Response.json({
        appUrl: "x",
        cardId: "card_1",
        status: "created",
      });
    },
  });

  test("uploads a file, then creates its card with the type Teak reads from it", async () => {
    const bodies: unknown[] = [];
    const seen: string[] = [];
    const uploaded: unknown[] = [];
    const result = await clientFor(
      uploadRoutes(bodies),
      seen
    ).cards.createFromFile({
      bytes: new Blob(["%PDF-1.7"], { type: "application/octet-stream" }),
      fileName: "paper.pdf",
      onUploaded: (done) => {
        uploaded.push(done);
      },
      tags: ["reading"],
    });
    expect(result.cardId).toBe("card_1");
    expect(seen).toEqual([
      "POST /v1/uploads",
      "PUT https://files.example/put/1",
      "POST /v1/cards",
    ]);
    expect(bodies).toEqual([
      { fileName: "paper.pdf", fileSize: 8, mimeType: "application/pdf" },
      {
        cardType: "document",
        fileEtag: '"e1"',
        fileKey: "uploads/1",
        fileName: "paper.pdf",
        fileSize: 8,
        mimeType: "application/pdf",
        tags: ["reading"],
      },
    ]);
    expect(uploaded).toEqual([{ fileEtag: '"e1"', fileKey: "uploads/1" }]);
  });

  test("an earlier attempt's upload creates the card without uploading again", async () => {
    const seen: string[] = [];
    await clientFor(uploadRoutes([]), seen).cards.createFromFile({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "photo.png",
      uploaded: { fileKey: "uploads/0" },
    });
    expect(seen).toEqual(["POST /v1/cards"]);
  });

  test("a cancelled save stops before the next step and makes no card", async () => {
    const seen: string[] = [];
    const controller = new AbortController();
    const routes = uploadRoutes([]);
    const put = routes["PUT https://files.example/put/1"];
    routes["PUT https://files.example/put/1"] = (request) => {
      controller.abort();
      return put(request);
    };
    const error = await rejection(
      clientFor(routes, seen).cards.createFromFile(
        { bytes: new Uint8Array([1, 2, 3]), fileName: "photo.png" },
        { signal: controller.signal }
      )
    );
    expect(error).toBeDefined();
    expect(seen).toEqual([
      "POST /v1/uploads",
      "PUT https://files.example/put/1",
    ]);
  });

  test("an already-cancelled save sends nothing", async () => {
    const seen: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await rejection(
      clientFor(uploadRoutes([]), seen).cards.createFromFile(
        { bytes: new Uint8Array([1, 2, 3]), fileName: "photo.png" },
        { signal: controller.signal }
      )
    );
    expect(seen).toEqual([]);
  });

  test.each([
    ["an empty file", new Uint8Array(), "photo.png", "FILE_TOO_LARGE"],
    [
      "a type Teak can't save",
      new Uint8Array([1]),
      "tool.exe",
      "UNSUPPORTED_TYPE",
    ],
  ])(
    "refuses %s before uploading anything",
    async (_label, bytes, fileName, code) => {
      const seen: string[] = [];
      const error = await rejection(
        clientFor(uploadRoutes([]), seen).cards.createFromFile({
          bytes,
          fileName,
        })
      );
      expect(error.code as string).toBe(code);
      expect(seen).toEqual([]);
    }
  );
});

describe("cards.pages", () => {
  test("follows each page's cursor until the listing ends", async () => {
    const seen: string[] = [];
    const client = clientFor(
      {
        "GET /v1/cards": (request) => {
          const cursor = new URL(request.url).searchParams.get("cursor");
          const next = { c0: "c1", c1: "c2" }[cursor ?? "c0"] ?? null;
          return Response.json({
            items: [{ id: cursor ?? "c0" }],
            pageInfo: { hasMore: next !== null, nextCursor: next },
          });
        },
      },
      seen
    );
    const ids: string[] = [];
    for await (const page of client.cards.pages({ tag: "x" })) {
      ids.push(...page.items.map((item) => item.id));
    }
    expect(ids).toEqual(["c0", "c1", "c2"]);
    expect(seen).toHaveLength(3);
  });

  test("stops fetching when the caller stops reading", async () => {
    const seen: string[] = [];
    const client = clientFor(
      {
        "GET /v1/cards": () =>
          Response.json({
            items: [],
            pageInfo: { hasMore: true, nextCursor: "more" },
          }),
      },
      seen
    );
    for await (const _page of client.cards.pages()) {
      break;
    }
    expect(seen).toHaveLength(1);
  });
});

describe("waiting for background work", () => {
  const operation = (overrides: Partial<TagOperation>): TagOperation => ({
    changed: 0,
    completedAt: null,
    createdAt: Date.now(),
    error: null,
    from: "a",
    id: "op_1",
    kind: "rename",
    processed: 0,
    status: "running",
    to: "b",
    total: 2,
    updatedAt: Date.now(),
    ...overrides,
  });

  test("a tag change is read until it finishes", async () => {
    let reads = 0;
    const client = clientFor({
      "GET /v1/tags/operations/op_1": () => {
        reads += 1;
        return Response.json(
          operation({ status: reads < 2 ? "running" : "completed", changed: 2 })
        );
      },
    });
    const done = await client.tags.waitFor(operation({}), { intervalMs: 1 });
    expect(done.status).toBe("completed");
    expect(reads).toBe(2);
  });

  test("a tag change that stopped making progress comes back failed", async () => {
    const stalled = operation({
      updatedAt: Date.now() - TAG_OPERATION_STALL_MS - 1000,
    });
    const done = await clientFor({}).tags.waitFor(stalled, { intervalMs: 1 });
    expect(done.status).toBe("failed");
  });

  test("gives up at the timeout with the caller's error", async () => {
    const error = await rejection(
      waitFor(0, {
        intervalMs: 5,
        refresh: (value) => Promise.resolve(value + 1),
        running: () => true,
        timedOut: () => new Error("still going"),
        timeoutMs: 20,
      })
    );
    expect(error.message).toBe("still going");
  });

  test("an abort during a read ends the wait with the signal's reason", async () => {
    const controller = new AbortController();
    const error = await rejection(
      waitFor(0, {
        intervalMs: 1,
        refresh: () => {
          setTimeout(() => controller.abort(new Error("cancelled")), 5);
          return new Promise<number>(() => {
            // A read that never answers.
          });
        },
        running: () => true,
        signal: controller.signal,
        timeoutMs: 60_000,
      })
    );
    expect(error.message).toBe("cancelled");
  });
});

describe("exports.waitFor", () => {
  const stuck = () =>
    new Promise<Response>(() => {
      // The first status read never answers.
    });

  test("gives up at the timeout while the first read is pending", async () => {
    const error = await rejection(
      clientFor({ "GET /v1/exports/latest": stuck }).exports.waitFor({
        timeoutMs: 20,
      })
    );
    expect(error.code).toBe("TIMEOUT");
  });

  test("an abort ends the wait while the first read is pending", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("cancelled")), 5);
    const error = await rejection(
      clientFor({ "GET /v1/exports/latest": stuck }).exports.waitFor({
        signal: controller.signal,
        timeoutMs: 60_000,
      })
    );
    expect(error.message).toBe("cancelled");
  });
});

test("a cancelled bulk request sends nothing", async () => {
  const seen: string[] = [];
  const controller = new AbortController();
  controller.abort();
  await rejection(
    clientFor(
      { "POST /v1/cards/bulk": () => Response.json({ results: [] }) },
      seen
    ).cards.bulk("delete", [{ cardId: "c1" }], { signal: controller.signal })
  );
  expect(seen).toEqual([]);
});

test("a caller's signal cancels a listing", async () => {
  const client = createTeakClient({
    baseUrl: "https://api.example",
    retries: 0,
    tokenProvider: { getAccessToken: () => "token" },
    fetch: ((_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      })) as typeof fetch,
  });
  const controller = new AbortController();
  const listing = client.cards.list({}, { signal: controller.signal });
  controller.abort();
  expect((await rejection(listing)).code).toBe("TIMEOUT");
});
