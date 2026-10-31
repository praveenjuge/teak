import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import schema from "../schema";
import { queueCardProcessing } from "../workflowDispatch";

const modules = import.meta.glob("../**/*.ts");

const PRODUCT_URL = "https://shop.example/products/mug";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  await seedWorkosOwner(t, "owner");
  const fetchedAt = NOW - DAY_MS;
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "owner",
      type: "link",
      content: PRODUCT_URL,
      url: PRODUCT_URL,
      metadataStatus: "completed",
      processingStatus: {
        classify: { status: "completed", confidence: 1 },
      } as never,
      metadata: {
        linkPreview: {
          status: "success",
          url: PRODUCT_URL,
          title: "Mug",
          siteName: "Shop",
          fetchedAt,
        },
      },
      createdAt: 1,
      updatedAt: 1,
    })
  );
  const getCard = () => t.run((ctx) => ctx.db.get("cards", cardId));
  const sendRun = () => t.mutation(internal.workflowDispatch.claim, {});
  return { cardId, getCard, sendRun, t };
};

describe("Refresh details on a link", () => {
  test("queues a refresh run that reads the stored preview again", async () => {
    const { cardId, getCard, sendRun, t } = await setup();

    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    const claimed = await sendRun();

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.item).toMatchObject({
      params: { cardId, refresh: true },
      type: "workflow",
      workflow: "card-processing",
    });
    expect((await getCard())?.metadataStatus).toBe("pending");
  });

  test("an automatic rerun keeps a preview that worked", async () => {
    const { cardId, getCard, sendRun, t } = await setup();

    await t.run((ctx) => queueCardProcessing(ctx, cardId, { reset: true }));
    const claimed = await sendRun();

    expect(claimed[0]?.item).not.toMatchObject({ params: { refresh: true } });
    expect((await getCard())?.metadataStatus).toBe("completed");
  });

  test("a refresh that can't read the page keeps the stored preview", async () => {
    const { cardId, getCard, t } = await setup();
    const before = await getCard();

    await t.mutation(internal.linkMetadata.updateCardMetadata, {
      cardId,
      linkPreview: {
        status: "error",
        url: PRODUCT_URL,
        error: { type: "scrape_error", message: "Link page fetch unavailable" },
      },
      refresh: true,
      status: "failed",
    });

    const card = await getCard();
    expect(card?.metadataStatus).toBe("completed");
    expect(card?.metadata?.linkPreview).toEqual(before?.metadata?.linkPreview);
  });

  test("a metadata-only retry that replaces a waiting refresh runs the refresh in full", async () => {
    const { cardId, sendRun, t } = await setup();

    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    await t.run((ctx) =>
      queueCardProcessing(ctx, cardId, { metadataOnly: true })
    );
    const claimed = await sendRun();

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.item.params).toMatchObject({ refresh: true });
    expect(claimed[0]?.item.params.metadataOnly).toBeUndefined();
  });
});
