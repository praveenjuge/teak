/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import {
  afterAll,
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

const productPage = `<html><head><script type="application/ld+json">
{"@type":"Product","name":"Mug","offers":{"@type":"Offer","price":"24.99","priceCurrency":"USD"}}
</script></head></html>`;

// A workflow run sets `globalThis.process` to undefined, which breaks
// Vitest's loader when the run imports a workflow component module. Ignore
// those writes, as the workflow library allows test runtimes to.
const processDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "process"
);
beforeAll(() => {
  const nodeProcess = globalThis.process;
  Object.defineProperty(globalThis, "process", {
    configurable: true,
    get: () => nodeProcess,
    set: () => undefined,
  });
});
afterAll(() => {
  if (processDescriptor) {
    Object.defineProperty(globalThis, "process", processDescriptor);
  }
});

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  await seedWorkosOwner(t, "owner");
  const pageFetches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === PRODUCT_URL) {
        pageFetches.push(url);
        return Promise.resolve(
          new Response(productPage, {
            headers: { "content-type": "text/html" },
          })
        );
      }
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    })
  );
  // A product categorized a day ago, before its price could be read.
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
        },
        linkCategory: {
          category: "product",
          confidence: 0.9,
          sourceUrl: PRODUCT_URL,
          fetchedAt: categorizedAt,
          raw: {
            structured: { "@type": "Product", name: "Mug" },
            structuredMeta: { fetchedAt: categorizedAt },
          },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    })
  );
  /** The card's link details, once its categorize stage has finished. */
  const linkCategory = async () => {
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.processingStatus?.categorize?.status).toBe("completed");
    return card?.metadata?.linkCategory;
  };
  return { t, cardId, categorizedAt, linkCategory, pageFetches };
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

    expect(pageFetches).toEqual([PRODUCT_URL]);
    const refreshed = await linkCategory();
    expect(refreshed?.category).toBe("product");
    expect(refreshed?.fetchedAt).toBeGreaterThan(categorizedAt);
    expect(refreshed?.price).toMatchObject({ amount: 24.99, currency: "USD" });
  });

  test("an automatic run within 30 days keeps the cached category", async () => {
    const { t, cardId, categorizedAt, linkCategory, pageFetches } =
      await setup();

    await t.action(internal["workflows/manager"].startCardProcessingWorkflow, {
      cardId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(pageFetches).toEqual([]);
    const after = await linkCategory();
    expect(after?.fetchedAt).toBe(categorizedAt);
    expect(after?.price).toBeUndefined();
  });
});
