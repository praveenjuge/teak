/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { archiveCardHandler } from "./storage/rawMetadataMaintenance";
import type { ActionCtx } from "./_generated/server";
import { cardStorageObjectKeys } from "./storage/r2";
import {
  copyAndVerifyRaw,
  hashRawMetadata,
  hydrateArchivedMetadata,
  rawMetadataKey,
  serializeRawMetadata,
} from "./storage/rawMetadata";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "archive-test-user",
      type: "link",
      content: "Customer content",
      url: "https://example.com",
      createdAt: 10,
      updatedAt: 20,
      tags: ["keep"],
      notes: "Customer notes",
      isFavorited: true,
      metadata: {
        linkPreview: {
          title: "Original title",
          raw: [{ selector: "meta", results: [{ text: "x".repeat(1100) }] }],
        },
        linkCategory: {
          category: "article",
          sourceUrl: "https://example.com",
          fetchedAt: 123,
          raw: {
            structured: { headline: "Keep".repeat(300) },
            structuredMeta: { fetchedAt: 120 },
          },
        },
      },
    })
  );
  const card = await t.run((ctx) => ctx.db.get("cards", cardId));
  if (!card) {
    throw new Error("missing fixture");
  }
  const expectedJson = serializeRawMetadata(card.metadata?.linkPreview?.raw)!;
  const digest = await hashRawMetadata(expectedJson);
  return {
    t,
    card,
    cardId,
    args: {
      cardId,
      kind: "linkPreview" as const,
      expectedJson,
      digest,
      key: rawMetadataKey(card, "linkPreview", digest),
    },
  };
};

describe("raw metadata archival", () => {
  test("verified archive CAS preserves all customer fields and concurrent unrelated metadata", async () => {
    const { t, cardId, args, card } = await setup();
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, {
        metadata: {
          ...card.metadata,
          linkPreview: { ...card.metadata?.linkPreview, title: "New title" },
        },
        notes: "Updated customer notes",
      })
    );
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        args
      )
    ).toBe(true);
    const result = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(result).toMatchObject({
      content: card.content,
      notes: "Updated customer notes",
      updatedAt: 20,
      tags: ["keep"],
      isFavorited: true,
      metadata: {
        linkPreview: {
          title: "New title",
          rawStorageKey: args.key,
          rawSha256: args.digest,
        },
        linkCategory: card.metadata?.linkCategory,
      },
    });
    expect(result?.metadata?.linkPreview?.raw).toBeUndefined();
    expect(cardStorageObjectKeys(result!)).toContain(args.key);
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        args
      )
    ).toBe(true);
  });

  test("commitArchive stands down during account deletion", async () => {
    const { t, cardId, args, card } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: card.userId,
        startedAt: Date.now(),
      })
    );
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        args
      )
    ).toBe(false);
    const result = await t.run((ctx) => ctx.db.get("cards", cardId));
    // The card keeps its inline raw payload: no archive commit raced the
    // deletion batches, and account deletion removes the card and its
    // storage objects together.
    expect(result?.metadata?.linkPreview?.raw).toEqual(
      card.metadata?.linkPreview?.raw
    );
    expect(result?.metadata?.linkPreview?.rawStorageKey).toBeUndefined();
  });

  test("failed commit enqueue retains the copy key for a commit-only retry", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card, args } = await setup();
    const archiveCard = {
      ...card,
      metadata: { linkPreview: card.metadata?.linkPreview },
    };
    const objects = new Map<string, Uint8Array>();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (init?.method === "PUT") {
        const key = decodeURIComponent(path.replace("/__upload/v1/", ""));
        const bytes = init.body as Uint8Array;
        objects.set(key, bytes);
        return Response.json({
          ok: true,
          data: { etag: "etag", key, size: bytes.byteLength },
        });
      }
      const bytes = objects.get(path.slice(1));
      return bytes
        ? new Response(new Uint8Array(bytes))
        : new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const retry = vi.fn(
      async (_delay: number, _fn: unknown, _args: typeof args) => "scheduled"
    );
    const ctx = {
      runQuery: vi.fn(async () => archiveCard),
      runMutation: vi.fn(async () => {
        throw new Error("cleanup enqueue unavailable");
      }),
      scheduler: { runAfter: retry },
    } as unknown as ActionCtx;
    expect(await archiveCardHandler(ctx, { cardId })).toEqual({
      archived: 0,
      skipped: 1,
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(
      60_000,
      internal.storage.rawMetadataMaintenance.commitArchive,
      args
    );
    expect(fetchMock).toHaveBeenCalledTimes(2); // one upload and one verification, no recopy
    // The durable retry carries the key even after the owning card disappears.
    await t.run((dbCtx) => dbCtx.db.delete("cards", cardId));
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        retry.mock.calls[0][2]
      )
    ).toBe(false);
    const pending = await t.run((dbCtx) =>
      dbCtx.db.system.query("_scheduled_functions").collect()
    );
    expect(
      pending.some((scheduled) => scheduled.args[0]?.keys?.includes(args.key))
    ).toBe(true);
  });

  test("commitArchive removes the orphaned copy when the card is gone", async () => {
    const { t, cardId, args } = await setup();
    await t.run((ctx) => ctx.db.delete("cards", cardId));
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        args
      )
    ).toBe(false);
    const pending = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    // The copied archive is unreferenced with the card gone, so its
    // deletion is scheduled rather than leaked.
    expect(pending).toHaveLength(1);
    expect(pending[0].args).toEqual([{ keys: [args.key] }]);
  });

  test("stale raw, missing cards, wrong namespace and wrong hash never clear data", async () => {
    const { t, cardId, args, card } = await setup();
    expect(
      await t.mutation(internal.storage.rawMetadataMaintenance.commitArchive, {
        ...args,
        key: `users/other/${args.digest}`,
      })
    ).toBe(false);
    expect(
      await t.mutation(internal.storage.rawMetadataMaintenance.commitArchive, {
        ...args,
        digest: "0".repeat(64),
      })
    ).toBe(false);
    const newerRaw = [{ selector: "new", results: [] }];
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, {
        metadata: {
          ...card.metadata,
          linkPreview: { ...card.metadata?.linkPreview, raw: newerRaw },
        },
      })
    );
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        args
      )
    ).toBe(false);
    expect(
      (await t.run((ctx) => ctx.db.get("cards", cardId)))?.metadata?.linkPreview
        ?.raw
    ).toEqual(newerRaw);
    await t.run((ctx) => ctx.db.delete("cards", cardId));
    expect(
      await t.mutation(
        internal.storage.rawMetadataMaintenance.commitArchive,
        args
      )
    ).toBe(false);
  });

  test("category archival preserves freshness facts and both archive references are tracked", async () => {
    const { t, cardId, card } = await setup();
    const expectedJson = serializeRawMetadata(
      card.metadata?.linkCategory?.raw
    )!;
    const digest = await hashRawMetadata(expectedJson);
    const key = rawMetadataKey(card, "linkCategory", digest);
    expect(
      await t.mutation(internal.storage.rawMetadataMaintenance.commitArchive, {
        cardId,
        kind: "linkCategory",
        key,
        digest,
        expectedJson,
      })
    ).toBe(true);
    const result = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(result?.metadata?.linkCategory).toMatchObject({
      rawStorageKey: key,
      rawSha256: digest,
      rawHasStructured: true,
      rawStructuredFetchedAt: 120,
    });
    const page = await t.query(
      internal.workflows.orphanSweepQueries.pageSweepCards,
      { numItems: 10 }
    );
    expect(cardStorageObjectKeys(page.cards[0])).toContain(key);
  });

  test("default migration is dry-run, bounded and retains inline data", async () => {
    const { t, cardId } = await setup();
    const result = await t.action(
      internal.storage.rawMetadataMaintenance.archivePage,
      { limit: 1 }
    );
    expect(result.dryRun).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(
      (await t.run((ctx) => ctx.db.get("cards", cardId)))?.metadata?.linkPreview
        ?.raw
    ).toBeDefined();
    await expect(
      t.query(internal.storage.rawMetadataMaintenance.pageInlineRaw, {
        limit: 51,
      })
    ).rejects.toThrow("limit");
  });

  test("archive action copies both raw payloads and restores every original field", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card } = await setup();
    const objects = new Map<string, Uint8Array>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (init?.method === "PUT") {
          const key = decodeURIComponent(path.replace("/__upload/v1/", ""));
          const bytes = init.body as Uint8Array;
          objects.set(key, bytes);
          return Promise.resolve(
            Response.json({
              ok: true,
              data: { etag: "etag", key, size: bytes.byteLength },
            })
          );
        }
        const bytes = objects.get(path.slice(1));
        return Promise.resolve(
          bytes
            ? new Response(new Uint8Array(bytes))
            : new Response("missing", { status: 404 })
        );
      })
    );
    expect(
      await t.action(internal.storage.rawMetadataMaintenance.archiveCard, {
        cardId,
      })
    ).toEqual({ archived: 2, skipped: 0 });
    const archived = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(archived?.metadata?.linkPreview?.raw).toBeUndefined();
    expect(archived?.metadata?.linkCategory?.raw).toBeUndefined();
    const hydrated = await hydrateArchivedMetadata(archived!);
    expect(hydrated.metadata?.linkPreview?.raw).toEqual(
      card.metadata?.linkPreview?.raw
    );
    expect(hydrated.metadata?.linkCategory?.raw).toEqual(
      card.metadata?.linkCategory?.raw
    );
    const { metadata: _originalMetadata, ...originalFields } = card;
    const { metadata: _archivedMetadata, ...archivedFields } = archived!;
    expect(archivedFields).toEqual(originalFields);
  });

  test("a failed card remains intact while later cards archive and the page cursor advances", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card } = await setup();
    const { _id: _originalId, _creationTime: _originalTime, ...fields } = card;
    const [second, third] = await t.run(async (ctx) => [
      await ctx.db.insert("cards", fields),
      await ctx.db.insert("cards", fields),
    ]);
    const objects = new Map<string, Uint8Array>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (init?.method === "PUT") {
          const key = decodeURIComponent(path.replace("/__upload/v1/", ""));
          if (key.includes(`/cards/${cardId}/`)) {
            return Promise.resolve(
              new Response("unavailable", { status: 503 })
            );
          }
          const bytes = init.body as Uint8Array;
          objects.set(key, bytes);
          return Promise.resolve(
            Response.json({
              ok: true,
              data: { etag: "etag", key, size: bytes.byteLength },
            })
          );
        }
        const bytes = objects.get(path.slice(1));
        return Promise.resolve(
          bytes
            ? new Response(new Uint8Array(bytes))
            : new Response("missing", { status: 404 })
        );
      })
    );
    const page = await t.action(
      internal.storage.rawMetadataMaintenance.archivePage,
      { limit: 2, dryRun: false }
    );
    expect(page.failed).toEqual([{ cardId, error: "archive_failed" }]);
    expect(page.archived).toBe(2);
    expect(page.cursor).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toEqual(card);
    expect(
      (await t.run((ctx) => ctx.db.get("cards", second)))?.metadata?.linkPreview
        ?.raw
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.get("cards", third)))?.metadata?.linkPreview
        ?.raw
    ).toBeDefined();
    const next = await t.query(
      internal.storage.rawMetadataMaintenance.pageInlineRaw,
      { limit: 2, cursor: page.cursor! }
    );
    expect(
      next.cards.map((item: { cardId: Doc<"cards">["_id"] }) => item.cardId)
    ).toEqual([third]);
  });

  test("failed upload or corrupt readback never clears inline customer metadata", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 }))
    );
    await expect(
      t.action(internal.storage.rawMetadataMaintenance.archiveCard, {
        cardId,
        attempt: 2,
      })
    ).rejects.toThrow("files_worker_upload_error");
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toEqual(card);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) =>
        init?.method === "PUT"
          ? Response.json({
              ok: true,
              data: { etag: "etag", key: "key", size: 2 },
            })
          : new Response("{}")
      )
    );
    await expect(
      t.action(internal.storage.rawMetadataMaintenance.archiveCard, {
        cardId,
        attempt: 2,
      })
    ).rejects.toThrow("hash_mismatch");
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toEqual(card);
  });

  test("timed-out uploads preserve inline metadata and schedule a bounded retry", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.reject(
          new DOMException("Upload timed out", "TimeoutError")
        );
      })
    );
    await expect(
      t.action(internal.storage.rawMetadataMaintenance.archiveCard, { cardId })
    ).rejects.toThrow("Upload timed out");
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toEqual(card);
    const pending = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].args).toEqual([{ cardId, attempt: 1 }]);
  });

  test("tiny diagnostics remain inline without any Worker request", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card } = await setup();
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, {
        metadata: {
          linkPreview: { ...card.metadata?.linkPreview, raw: [] },
          linkCategory: {
            ...card.metadata!.linkCategory!,
            raw: { provider: "small" },
          },
        },
      })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await t.query(internal.storage.rawMetadataMaintenance.pageInlineRaw, {}))
        .cards
    ).toHaveLength(0);
    expect(
      await t.action(internal.storage.rawMetadataMaintenance.archiveCard, {
        cardId,
      })
    ).toEqual({ archived: 0, skipped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (await t.run((ctx) => ctx.db.get("cards", cardId)))?.metadata
        ?.linkCategory?.raw
    ).toEqual({ provider: "small" });
  });

  test("lossy JSON values and oversized diagnostics stay inline", () => {
    for (const raw of [
      undefined,
      Number.NaN,
      -0,
      1n,
      new Uint8Array([1]),
      { value: undefined },
      "x".repeat(512 * 1024 + 1),
    ]) {
      expect(serializeRawMetadata(raw)).toBeNull();
    }
  });

  test("copy verifies signed readback, and hydration reconstructs identical raw without mutating card", async () => {
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const json = JSON.stringify({ provider: { source: "keep" } });
    const digest = await hashRawMetadata(json);
    const { card: fixture } = await setup();
    const key = rawMetadataKey(fixture, "linkCategory", digest);
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "PUT"
        ? Response.json({
            ok: true,
            data: { etag: "etag", key, size: json.length },
          })
        : new Response(json)
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      copyAndVerifyRaw(fixture, "linkCategory", json, "../bad")
    ).rejects.toThrow("invalid_key");
    await expect(
      copyAndVerifyRaw(
        { ...fixture, _id: "../other" as Doc<"cards">["_id"] },
        "linkCategory",
        json,
        digest
      )
    ).rejects.toThrow("invalid_key");
    expect(fetchMock).not.toHaveBeenCalled();
    await copyAndVerifyRaw(fixture, "linkCategory", json, digest);
    expect(fetchMock.mock.calls[1][1]?.redirect).toBe("error");
    expect(fetchMock.mock.calls[0][1]?.body).toEqual(
      new TextEncoder().encode(json)
    );
    const card: Pick<Doc<"cards">, "_id" | "userId" | "metadata"> = {
      _id: fixture._id,
      userId: fixture.userId,
      metadata: {
        linkCategory: {
          category: "article" as const,
          sourceUrl: "https://example.com",
          fetchedAt: 123,
          rawStorageKey: key,
          rawSha256: digest,
        },
      },
    };
    await expect(
      hydrateArchivedMetadata({ ...card, userId: "other-user" })
    ).rejects.toThrow("namespace_mismatch");
    await expect(
      hydrateArchivedMetadata({
        ...card,
        metadata: {
          linkCategory: {
            ...card.metadata!.linkCategory!,
            rawSha256: "invalid",
          },
        },
      })
    ).rejects.toThrow("digest_missing");
    const hydrated = await hydrateArchivedMetadata(card);
    expect(hydrated.metadata?.linkCategory?.raw).toEqual(JSON.parse(json));
    expect(card.metadata?.linkCategory).not.toHaveProperty("raw");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}"))
    );
    await expect(hydrateArchivedMetadata(card)).rejects.toThrow(
      "hash_mismatch"
    );
  });
});
