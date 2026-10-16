/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { internal } from "./_generated/api";
import schema from "./schema";

// Outbound DNS and sockets; the page itself comes from the stubbed fetch.
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));
vi.mock("undici", () => ({
  Agent: class {
    close() {
      return Promise.resolve();
    }
  },
}));

const modules = import.meta.glob("./**/*.ts");

const PRODUCT_URL = "https://shop.example/products/mug";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;

const productPage = `<html><head><meta property="og:title" content="Blue mug">
<script type="application/ld+json">
{"@type":"Product","name":"Mug","offers":{"@type":"Offer","price":"24.99","priceCurrency":"USD"}}
</script></head></html>`;

// A workflow run sets `process` to undefined for its own calls, and Vitest
// cannot import a module without it. Load the workflow component's modules
// before any run so a run never has to import one.
let preloadedWorkflowModules: Record<string, () => Promise<unknown>> = {};
beforeAll(async () => {
  const entries = await Promise.all(
    Object.entries(workflowTest.modules)
      .filter(
        ([path]) => !(path.endsWith(".test.ts") || path.endsWith(".config.ts"))
      )
      .map(async ([path, load]) => {
        const loaded = await (load as () => Promise<unknown>)();
        return [path, () => Promise.resolve(loaded)] as const;
      })
  );
  preloadedWorkflowModules = Object.fromEntries(entries);
});

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = async ({ pageReachable = true } = {}) => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  t.registerComponent(
    "workflow",
    workflowTest.schema,
    preloadedWorkflowModules
  );
  workosTest.register(t);
  await seedWorkosOwner(t, "owner");
  const pageFetches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === PRODUCT_URL) {
        pageFetches.push(url);
        if (!pageReachable) {
          return Promise.resolve(new Response("unavailable", { status: 503 }));
        }
        return Promise.resolve(
          new Response(productPage, {
            headers: { "content-type": "text/html" },
          })
        );
      }
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    })
  );
  // A product filed as an article a day ago, under older rules, without
  // its price.
  const categorizedAt = NOW - DAY_MS;
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "owner",
      type: "link",
      content: PRODUCT_URL,
      url: PRODUCT_URL,
      metadataStatus: "completed",
      processingStatus: {
        classify: { status: "completed", confidence: 1 },
      } as any,
      metadata: {
        linkPreview: {
          status: "success",
          url: PRODUCT_URL,
          title: "Mug",
          siteName: "Shop",
          fetchedAt: categorizedAt,
        },
        linkCategory: {
          category: "article",
          confidence: 0.9,
          sourceUrl: PRODUCT_URL,
          fetchedAt: categorizedAt,
          raw: {
            structured: { "@type": "Article", headline: "Mug" },
            structuredMeta: { fetchedAt: categorizedAt },
          },
        },
      },
      thumbnailOverride: {
        storageKey: "users/owner/cards/chosen/thumbnail-override.png",
        width: 800,
        height: 600,
        updatedAt: categorizedAt,
      },
      createdAt: 1,
      updatedAt: 1,
    })
  );
  const getCard = () => t.run((ctx) => ctx.db.get("cards", cardId));
  /** The card's link details, once its categorize stage has finished. */
  const linkCategory = async () => {
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.processingStatus?.categorize?.status).toBe("completed");
    return card?.metadata?.linkCategory;
  };
  return { t, cardId, categorizedAt, getCard, linkCategory, pageFetches };
};

describe("Refresh details on a link", () => {
  test("re-categorizes a link categorized within 30 days and reads its price again", async () => {
    const { t, cardId, categorizedAt, linkCategory, pageFetches } =
      await setup();

    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // Once for the link preview, once for the page's JSON-LD.
    expect(pageFetches).toEqual([PRODUCT_URL, PRODUCT_URL]);
    const refreshed = await linkCategory();
    expect(refreshed?.category).toBe("product");
    expect(refreshed?.fetchedAt).toBeGreaterThan(categorizedAt);
    expect(refreshed?.price).toMatchObject({ amount: 24.99, currency: "USD" });
  });

  test("fetches the link preview again and keeps the image the person chose", async () => {
    const { t, cardId, categorizedAt, getCard } = await setup();
    const before = await getCard();

    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const card = await getCard();
    expect(card?.metadataStatus).toBe("completed");
    expect(card?.metadata?.linkPreview).toMatchObject({
      status: "success",
      title: "Blue mug",
    });
    expect(card?.metadata?.linkPreview?.fetchedAt).toBeGreaterThan(
      categorizedAt
    );
    expect(card?.metadataTitle).toBe("Blue mug");
    expect(card?.thumbnailOverride).toEqual(before?.thumbnailOverride);
  });

  test("a refresh that can't read the page keeps the stored preview and finishes", async () => {
    const { t, cardId, getCard, pageFetches } = await setup({
      pageReachable: false,
    });
    const before = await getCard();

    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // The preview fetch was retried before giving up.
    expect(pageFetches.length).toBeGreaterThan(2);
    const card = await getCard();
    expect(card?.metadataStatus).toBe("completed");
    expect(card?.metadata?.linkPreview).toEqual(before?.metadata?.linkPreview);
    // The run went on past the preview to categorize the link.
    expect(card?.processingStatus?.categorize?.status).toBe("completed");
  });

  test("an automatic run within 30 days keeps the cached category and preview", async () => {
    const { t, cardId, categorizedAt, getCard, linkCategory, pageFetches } =
      await setup();

    await t.action(internal["workflows/manager"].startCardProcessingWorkflow, {
      cardId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(pageFetches).toEqual([]);
    const card = await getCard();
    expect(card?.metadata?.linkPreview?.title).toBe("Mug");
    const after = await linkCategory();
    expect(after?.category).toBe("article");
    expect(after?.fetchedAt).toBe(categorizedAt);
    expect(after?.price).toBeUndefined();
  });
});
