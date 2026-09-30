import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../../../../_generated/server";
import {
  classifyHandler,
  fetchStructuredDataHandler,
  mergeAndSaveHandler,
} from "../../../../workflows/steps/categorization/index";

const originalFetch = globalThis.fetch;
const originalEnv = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
};
const sourceUrl = "https://93.184.215.14/blog/article";
const providerPayload = "saved-provider-data".repeat(2000);
const article = {
  "@type": "Article",
  headline: "Archived article",
  description: "structured-description".repeat(2000),
  datePublished: "2026-09-20",
  image: "https://example.com/cover.jpg",
};
const stored = new Map<string, Uint8Array>();
const persisted: unknown[] = [];
let card: any;
const ctx = {
  runQuery: async (_ref: unknown, args: { cardId?: string }) =>
    args.cardId
      ? card
      : { workflow: { args: { cardId: "card1" }, generationNumber: 3 } },
  runMutation: (ref: Parameters<typeof getFunctionName>[0], args: any) => {
    if (getFunctionName(ref).endsWith(":registerArtifact")) {
      return Promise.resolve(true);
    }
    persisted.push(args.metadata);
    return Promise.resolve(null);
  },
} as unknown as ActionCtx;

beforeEach(() => {
  process.env.FILES_BASE = "https://files.teakvault.com";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  delete process.env.R2_KEY_PREFIX;
  stored.clear();
  persisted.length = 0;
  card = {
    _id: "card1",
    userId: "user1",
    type: "link",
    url: sourceUrl,
    content: "customer content",
    notes: "customer notes",
    aiTranscript: "customer transcript",
    metadata: {
      linkCategory: {
        category: "article",
        confidence: 0.85,
        fetchedAt: 0,
        sourceUrl,
        raw: { provider: { name: "original", payload: providerPayload } },
      },
      linkPreview: {
        status: "success",
        title: "Article",
        raw: [{ selector: "title", results: [{ text: providerPayload }] }],
      },
    },
  };
  globalThis.fetch = mock(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === new URL(sourceUrl).origin) {
        return Promise.resolve(
          new Response(
            `<script type="application/ld+json">${JSON.stringify(article)}</script>`,
            {
              headers: { "content-type": "text/html", etag: "source-etag" },
            }
          )
        );
      }
      const key = decodeURIComponent(
        url.pathname.replace(/^\/__upload\/v1\//, "").replace(/^\//, "")
      );
      if (init?.method === "PUT") {
        stored.set(key, new Uint8Array(init.body as Uint8Array));
        return Promise.resolve(Response.json({ ok: true, data: { key } }));
      }
      const bytes = stored.get(key);
      return Promise.resolve(
        new Response(bytes ? Uint8Array.from(bytes).buffer : null, {
          status: bytes ? 200 : 404,
        })
      );
    }
  ) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("classification and structured artifacts hydrate before enrichment persists saved raw metadata", async () => {
  const before = structuredClone(card);
  const classified = await classifyHandler(ctx, {
    cardId: card._id,
    workflowId: "workflow1",
  });
  expect(classified.mode).toBe("classified");
  if (classified.mode === "missing") {
    throw new Error("Expected classified snapshot");
  }
  expect(classified.card.artifactVersion).toBe(1);
  expect(classified.existingMetadata).toBeUndefined();
  const structured = await fetchStructuredDataHandler(ctx, {
    cardId: card._id,
    workflowId: "workflow1",
    sourceUrl: classified.sourceUrl,
    shouldFetch: classified.shouldFetchStructured,
  });
  expect(structured.structuredData.artifactVersion).toBe(1);
  expect(stored.size).toBe(2);
  // Change current metadata after journaling. Enrichment must consume the
  // immutable saved snapshot rather than silently re-reading changed fields.
  card.metadata.linkCategory.raw.provider.payload = "changed after snapshot";
  const result = await mergeAndSaveHandler(ctx, {
    ...classified,
    cardId: card._id,
    workflowId: "workflow1",
    structuredData: structured.structuredData,
  });
  expect(result.category).toBe("article");
  expect(result.imageUrl).toBe(article.image);
  expect(result.factsCount).toBeGreaterThan(0);
  expect(persisted).toHaveLength(1);
  expect(persisted[0]).toMatchObject({
    category: "article",
    imageUrl: article.image,
    raw: {
      provider: { payload: providerPayload },
      structured: article,
      structuredMeta: { etag: "source-etag" },
    },
  });
  expect(JSON.stringify(persisted[0])).not.toContain('"artifactVersion"');
  for (const value of [before.content, before.notes, before.aiTranscript]) {
    expect(JSON.stringify(persisted[0])).not.toContain(value);
  }
  for (const body of stored.values()) {
    const archived = JSON.parse(new TextDecoder().decode(body));
    expect(archived).not.toHaveProperty("content");
    expect(archived).not.toHaveProperty("notes");
    expect(archived).not.toHaveProperty("aiTranscript");
  }
});

test("fresh cached categorization restores the complete saved provider metadata from its artifact", async () => {
  card.metadata.linkCategory.fetchedAt = Date.now();
  const originalMetadata = structuredClone(card.metadata.linkCategory);
  const classified = await classifyHandler(ctx, {
    cardId: card._id,
    workflowId: "workflow1",
  });
  expect(classified.mode).toBe("skipped");
  if (classified.mode === "missing") {
    throw new Error("Expected cached snapshot");
  }
  expect(classified.card.artifactVersion).toBe(1);
  expect(classified.existingMetadata).toBeUndefined();
  card.metadata.linkCategory.raw.provider.payload = "changed after snapshot";
  await mergeAndSaveHandler(ctx, {
    ...classified,
    cardId: card._id,
    workflowId: "workflow1",
  });
  expect(persisted).toEqual([originalMetadata]);
});
