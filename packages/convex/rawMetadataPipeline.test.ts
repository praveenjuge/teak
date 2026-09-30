/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { hydrateArchivedMetadata } from "./storage/rawMetadata";

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
  return { t, card, cardId };
};

const installFilesWorker = () => {
  vi.stubEnv("FILES_BASE", "https://files.example.com");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
  const objects = new Map<string, Uint8Array>();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
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
  });
  vi.stubGlobal("fetch", fetchMock);
  return { objects, fetchMock };
};

describe("raw metadata pipeline", () => {
  test.each([
    { writer: "preview", large: true },
    { writer: "preview", large: false },
    { writer: "category", large: true },
    { writer: "category", large: false },
  ])(
    "$writer writer archives large=$large diagnostics through the scheduled pipeline",
    async ({ writer, large }) => {
      vi.useFakeTimers();
      const { objects, fetchMock } = installFilesWorker();
      const { t, cardId, card } = await setup();
      await t.run((ctx) => ctx.db.patch("cards", cardId, { metadata: {} }));
      const raw =
        writer === "preview"
          ? [
              {
                selector: "meta",
                results: [{ text: "x".repeat(large ? 1100 : 10) }],
              },
            ]
          : { provider: { text: "x".repeat(large ? 1100 : 10) } };
      if (writer === "preview") {
        await t.mutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          status: "completed",
          linkPreview: { status: "success", title: "New preview title", raw },
        });
      } else {
        await t.mutation(
          internal.workflows.steps.categorization.mutations
            .updateCategorization,
          {
            cardId,
            metadata: {
              category: "article",
              sourceUrl: card.url,
              fetchedAt: Date.now(),
              raw,
            },
          }
        );
      }
      const beforeArchival = await t.run((ctx) => ctx.db.get("cards", cardId));
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const afterArchival = await t.run((ctx) => ctx.db.get("cards", cardId));
      const part =
        afterArchival?.metadata?.[
          writer === "preview" ? "linkPreview" : "linkCategory"
        ];
      if (large) {
        expect(part?.raw).toBeUndefined();
        expect(objects.has(part!.rawStorageKey!)).toBe(true);
        expect(
          (await hydrateArchivedMetadata(afterArchival!)).metadata?.[
            writer === "preview" ? "linkPreview" : "linkCategory"
          ]?.raw
        ).toEqual(raw);
      } else {
        expect(part?.raw).toEqual(raw);
        expect(objects.size).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
      }
      expect(afterArchival).toMatchObject({
        content: card.content,
        notes: card.notes,
        tags: card.tags,
        isFavorited: true,
        updatedAt: beforeArchival!.updatedAt,
      });
    }
  );

  test.each([
    { hasStructured: true, fresh: false, shouldFetch: false },
    { hasStructured: false, fresh: true, shouldFetch: false },
    { hasStructured: false, fresh: false, shouldFetch: true },
  ])(
    "classification honors archived structured=$hasStructured freshness=$fresh",
    async ({ hasStructured, fresh, shouldFetch }) => {
      const { t, cardId, card } = await setup();
      await t.run((ctx) =>
        ctx.db.patch("cards", cardId, {
          metadata: {
            linkCategory: {
              category: "article",
              sourceUrl: card.url!,
              fetchedAt: 1,
              rawHasStructured: hasStructured,
              rawStructuredFetchedAt: fresh ? Date.now() : 1,
            },
          },
        })
      );
      const result = await t.action(
        internal.workflows.steps.categorization.index.classifyStep,
        { cardId }
      );
      expect(result.mode).toBe("classified");
      expect(result.shouldFetchStructured).toBe(shouldFetch);
    }
  );

  test("categorization enriches from archived preview data and preserves archived provider diagnostics", async () => {
    vi.useFakeTimers();
    installFilesWorker();
    const { t, cardId, card } = await setup();
    const sourceUrl = "https://www.goodreads.com/book/show/123";
    const rawPreview = [
      {
        selector: "meta[property='books:rating:average']",
        results: [{ attributes: [{ name: "content", value: "4.5" }] }],
      },
      {
        selector: "meta[property='books:isbn']",
        results: [
          { attributes: [{ name: "content", value: "9781234567890" }] },
        ],
      },
      { selector: "meta", results: [{ text: "x".repeat(1100) }] },
    ];
    const rawCategory = {
      structured: { headline: "Customer metadata".repeat(100) },
      structuredMeta: { fetchedAt: 120 },
      provider: { diagnostic: "Keep provider evidence" },
    };
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, {
        url: sourceUrl,
        metadata: {
          linkPreview: { status: "success", raw: rawPreview },
          linkCategory: {
            category: "book",
            sourceUrl,
            fetchedAt: 1,
            raw: rawCategory,
          },
        },
      })
    );
    expect(
      (
        await t.action(internal.storage.rawMetadataMaintenance.archiveCard, {
          cardId,
        })
      ).archived
    ).toBe(2);
    const archived = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(archived?.metadata?.linkPreview?.raw).toBeUndefined();
    expect(archived?.metadata?.linkCategory?.raw).toBeUndefined();
    const result = await t.action(
      internal.workflows.steps.categorization.index.mergeAndSaveStep,
      {
        cardId,
        card: archived,
        mode: "classified",
        sourceUrl,
        classification: {
          category: "book",
          providerHint: "goodreads",
          confidence: 0.9,
        },
        structuredData: null,
      }
    );
    expect(result.factsCount).toBe(2);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const enriched = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(enriched?.metadata?.linkCategory?.facts).toEqual(
      expect.arrayContaining([
        { label: "Average rating", value: "4.50 / 5" },
        { label: "ISBN", value: "9781234567890" },
      ])
    );
    const restored = await hydrateArchivedMetadata(enriched!);
    expect(restored.metadata?.linkCategory?.raw).toMatchObject({
      structured: rawCategory.structured,
      structuredMeta: rawCategory.structuredMeta,
      provider: {
        diagnostic: "Keep provider evidence",
        ratingAverage: "4.50",
        isbn: "9781234567890",
      },
    });
    expect(enriched).toMatchObject({
      content: card.content,
      notes: card.notes,
      tags: card.tags,
      isFavorited: true,
    });
  });

  test("migration reports remaining cards when its deadline expires without fetching or modifying them", async () => {
    vi.useFakeTimers();
    vi.stubEnv("FILES_BASE", "https://files.example.com");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
    const { t, cardId, card } = await setup();
    const { _id: _originalId, _creationTime: _originalTime, ...fields } = card;
    const [second, third] = await t.run(async (ctx) => [
      await ctx.db.insert("cards", fields),
      await ctx.db.insert("cards", fields),
    ]);
    const secondBefore = await t.run((ctx) => ctx.db.get("cards", second));
    const thirdBefore = await t.run((ctx) => ctx.db.get("cards", third));
    const objects = new Map<string, Uint8Array>();
    let advancedClock = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
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
      if (bytes && !advancedClock) {
        vi.setSystemTime(Date.now() + 4 * 60_000);
        advancedClock = true;
      }
      return Promise.resolve(
        bytes
          ? new Response(new Uint8Array(bytes))
          : new Response("missing", { status: 404 })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await t.action(
      internal.storage.rawMetadataMaintenance.archivePage,
      { limit: 3, dryRun: false }
    );
    expect(page.archived).toBe(2);
    expect(page.failed).toEqual([
      { cardId: second, error: "time_budget" },
      { cardId: third, error: "time_budget" },
    ]);
    expect(page.cursor).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      Array.from(objects.keys()).every((key) =>
        key.includes(`/cards/${cardId}/`)
      )
    ).toBe(true);
    expect(
      (await t.run((ctx) => ctx.db.get("cards", cardId)))?.metadata?.linkPreview
        ?.raw
    ).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("cards", second))).toEqual(
      secondBefore
    );
    expect(await t.run((ctx) => ctx.db.get("cards", third))).toEqual(
      thirdBefore
    );
  });
});
