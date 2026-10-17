import { describe, expect, test } from "bun:test";
import { createConvexRpc } from "../convexRpc";
import {
  CARD_ID,
  createCardConvex,
  createFakeOps,
  type FakeCard,
  makeCard,
  noNetwork,
  type OpAnswer,
  testEnv,
  textMetadataAnswer,
} from "../test/cardProcessingKit";
import { createFakeConvex, TEST_CONVEX_SITE_URL } from "../test/fakeConvex";
import {
  type AiBackfillMessage,
  enqueueAiBackfill,
  handleAiBackfillBatch,
} from "./aiBackfill";

const fakeQueue = () => {
  const sent: unknown[] = [];
  const queue = {
    sendBatch: (messages: Array<{ body: unknown }>) => {
      sent.push(...messages.map((message) => message.body));
      return Promise.resolve();
    },
  } as unknown as Queue<unknown>;
  return { queue, sent };
};

interface Outcome {
  acked: boolean;
  retried?: { delaySeconds?: number };
}

const batchOf = (bodies: unknown[], attempts = 1) => {
  const outcomes: Outcome[] = bodies.map(() => ({ acked: false }));
  const batch = {
    messages: bodies.map((body, index) => ({
      ack: () => {
        (outcomes[index] as Outcome).acked = true;
      },
      attempts,
      body,
      id: `m${index}`,
      retry: (options?: { delaySeconds?: number }) => {
        (outcomes[index] as Outcome).retried = options ?? {};
      },
      timestamp: new Date(),
    })),
    queue: "teak-ai-backfill",
  } as unknown as MessageBatch<AiBackfillMessage>;
  return { batch, outcomes };
};

const message = (rev = 1): AiBackfillMessage => ({
  cardId: CARD_ID,
  convexSiteUrl: TEST_CONVEX_SITE_URL,
  rev,
});

const consume = async (
  card: FakeCard,
  answers: Record<string, OpAnswer>,
  bodies: unknown[] = [message()],
  attempts = 1
) => {
  const convex = createCardConvex(card);
  const fakes = createFakeOps(answers);
  const env = testEnv();
  const { batch, outcomes } = batchOf(bodies, attempts);
  await handleAiBackfillBatch(batch, env, {
    convex: createConvexRpc(env, TEST_CONVEX_SITE_URL, convex.fetcher),
    filesOp: fakes.ops,
    ...noNetwork,
  });
  return { convex, fakes, outcomes };
};

describe("enqueueAiBackfill", () => {
  test("claims a batch and queues each card with its revision", async () => {
    const convex = createFakeConvex({
      "ai/backfill:claimAiBackfillCards": () => ({
        cards: [
          { cardId: "c1", rev: 3 },
          { cardId: "c2", rev: 0 },
        ],
        exhausted: 1,
      }),
    });
    const { queue, sent } = fakeQueue();
    const env = testEnv({ AI_BACKFILL: queue });

    const queued = await enqueueAiBackfill(env, TEST_CONVEX_SITE_URL, {
      convex: createConvexRpc(env, TEST_CONVEX_SITE_URL, convex.fetcher),
    });

    expect(queued).toBe(2);
    expect(sent).toEqual([
      { cardId: "c1", convexSiteUrl: TEST_CONVEX_SITE_URL, rev: 3 },
      { cardId: "c2", convexSiteUrl: TEST_CONVEX_SITE_URL, rev: 0 },
    ]);
  });

  test("claims nothing without the queue, so no attempt is spent", async () => {
    const convex = createFakeConvex({});
    const env = testEnv();
    await expect(
      enqueueAiBackfill(env, TEST_CONVEX_SITE_URL, {
        convex: createConvexRpc(env, TEST_CONVEX_SITE_URL, convex.fetcher),
      })
    ).rejects.toThrow("ai_backfill_queue_missing");
    expect(convex.calls).toEqual([]);
  });

  test("gives the attempts back when the queue refuses the batch", async () => {
    // The deployment counts an attempt per claim and gives it back on release.
    const attempts: Record<string, number> = { c1: 0, c2: 2 };
    const convex = createFakeConvex({
      "ai/backfill:claimAiBackfillCards": () => {
        for (const cardId of Object.keys(attempts)) {
          attempts[cardId] = (attempts[cardId] ?? 0) + 1;
        }
        return {
          cards: Object.keys(attempts).map((cardId) => ({ cardId, rev: 1 })),
          exhausted: 0,
        };
      },
      "ai/backfill:releaseAiBackfillCards": (args) => {
        for (const cardId of args.cardIds as string[]) {
          attempts[cardId] = (attempts[cardId] ?? 0) - 1;
        }
        return null;
      },
    });
    const queue = {
      sendBatch: () => Promise.reject(new Error("queue_unavailable")),
    } as unknown as Queue<unknown>;
    const env = testEnv({ AI_BACKFILL: queue });

    await expect(
      enqueueAiBackfill(env, TEST_CONVEX_SITE_URL, {
        convex: createConvexRpc(env, TEST_CONVEX_SITE_URL, convex.fetcher),
      })
    ).rejects.toThrow("queue_unavailable");
    expect(attempts).toEqual({ c1: 0, c2: 2 });
  });
});

describe("handleAiBackfillBatch", () => {
  test("generates the card's metadata, guarded by the claimed revision", async () => {
    const card = makeCard({ content: "Backfilled note", type: "text" });
    const { convex, outcomes } = await consume(card, {
      "generate-text-metadata": textMetadataAnswer(["note"]),
    });

    expect(outcomes).toEqual([{ acked: true }]);
    expect(card.aiTags).toEqual(["note"]);
    const save = convex.callsTo("workflows/aiMetadata/mutations:updateCardAI");
    expect(save[0]?.guard).toEqual({ cardId: CARD_ID, rev: 1 });
    // The backfill never marks the stage in progress.
    expect(convex.callsTo("card/processingRpc:markStagesInProgress")).toEqual(
      []
    );
  });

  test("Workers AI capacity retries the message a minute later per attempt", async () => {
    const card = makeCard({ content: "Busy" });
    const { outcomes } = await consume(
      card,
      {
        "generate-text-metadata": {
          throws: new Error("files_worker_ai: rate limit reached 429"),
        },
      },
      [message()],
      3
    );
    expect(outcomes).toEqual([
      { acked: false, retried: { delaySeconds: 180 } },
    ]);
  });

  test("a card edited since its claim is dropped without a write", async () => {
    const card = makeCard({ content: "Edited", processingRev: 2 });
    const { convex, outcomes } = await consume(
      card,
      { "generate-text-metadata": textMetadataAnswer() },
      [message(1)]
    );
    expect(outcomes).toEqual([{ acked: true }]);
    expect(card.aiTags).toBeUndefined();
    expect(
      convex.callsTo("workflows/aiMetadata/mutations:updateCardAI")
    ).toHaveLength(1);
  });

  test("other failures retry on the queue's schedule", async () => {
    const card = makeCard({
      fileKey: "users/x/cards/c/file/a.m4a",
      type: "audio",
    });
    const { outcomes } = await consume(card, {
      "process-audio": {
        throws: new Error("files_worker_error:RENDERER_UNAVAILABLE:503:r"),
      },
    });
    expect(outcomes).toEqual([{ acked: false, retried: {} }]);
  });

  test.each([
    ["no card", { convexSiteUrl: TEST_CONVEX_SITE_URL, rev: 1 }],
    [
      "an unknown deployment",
      { ...message(), convexSiteUrl: "https://evil.convex.site" },
    ],
    ["no revision", { cardId: CARD_ID, convexSiteUrl: TEST_CONVEX_SITE_URL }],
  ])("drops a message with %s", async (_name, body) => {
    const card = makeCard({ content: "x" });
    const { convex, outcomes } = await consume(card, {}, [body]);
    expect(outcomes).toEqual([{ acked: true }]);
    expect(convex.calls).toEqual([]);
  });

  test("a backfilled link gets its screenshot, then its images' text", async () => {
    const card = makeCard({
      metadata: { linkPreview: { status: "success", title: "A page" } },
      type: "link",
      url: "https://example.com/page",
    });
    const { fakes, outcomes } = await consume(card, {
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "fetch-link-page": {
        data: {
          charset: "utf-8",
          fetched: true,
          htmlGzipBase64: "H4sIAAAAAAAAA7PJMLTzSM3JyVcozy/KSQEAqZ/2YREAAAA=",
          pageUrl: "https://example.com/page",
          selectors: [],
          source: "static",
        },
      },
      "extract-image-text": { data: { text: "A page heading" } },
      "generate-link-metadata": textMetadataAnswer(["page"]),
    });
    expect(outcomes).toEqual([{ acked: true }]);
    expect(fakes.opsCalled().slice(-2)).toEqual([
      "capture-screenshot",
      "extract-image-text",
    ]);
    expect(card.processingStatus?.screenshot?.status).toBe("completed");
    expect(card.aiOcrText).toBe("A page heading");
  });
});
