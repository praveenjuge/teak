import { beforeEach, describe, expect, mock, test } from "bun:test";

const startWorkflow = mock(
  async (
    _ctx: unknown,
    _ref: unknown,
    _args: unknown,
    _options?: { startAsync?: boolean }
  ): Promise<unknown> => "workflow-id"
);

mock.module("../../workflows/manager", () => ({
  startWorkflow,
  workflow: { define: (config: unknown) => config },
}));

const loadWorkflow = async () => {
  const module = await import("../../workflows/aiBackfill");
  return {
    enqueueAiBackfillCard: module.enqueueAiBackfillCardHandler,
    maxAttempts: module.MAX_AI_BACKFILL_ATTEMPTS,
    aiBackfillWorkflow: module.aiBackfillWorkflow as unknown as {
      handler: (step: unknown) => Promise<{
        enqueuedCount: number;
        failedCardIds: string[];
      }>;
    },
    startAiBackfillWorkflow: {
      handler: (
        module.startAiBackfillWorkflow as unknown as {
          _handler: (
            ctx: unknown,
            args: { startAsync?: boolean }
          ) => Promise<unknown>;
        }
      )._handler,
    },
  };
};

describe("workflows/aiBackfill", () => {
  beforeEach(() => {
    startWorkflow.mockClear();
    startWorkflow.mockImplementation(
      async (_ctx: unknown, _ref: unknown, _args: unknown) => "workflow-id"
    );
  });

  test("returns an empty result without enqueueing when no cards need AI metadata", async () => {
    const { aiBackfillWorkflow } = await loadWorkflow();
    const runMutation = mock(async () => undefined);
    const step = {
      runMutation,
      runQuery: mock(async () => []),
    };

    const result = await aiBackfillWorkflow.handler(step);

    expect(result).toEqual({ enqueuedCount: 0, failedCardIds: [] });
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("enqueues every candidate and counts only the cards it started", async () => {
    const { aiBackfillWorkflow } = await loadWorkflow();
    const outcomes: Record<string, string> = {
      "card-1": "enqueued",
      "card-2": "enqueued",
      "card-3": "exhausted",
    };
    const runMutation = mock(
      async (_ref: unknown, args: { cardId: string }) => outcomes[args.cardId]
    );
    const step = {
      runMutation,
      runQuery: mock(async () => [
        { cardId: "card-1" },
        { cardId: "card-2" },
        { cardId: "card-3" },
      ]),
    };

    const result = await aiBackfillWorkflow.handler(step);

    expect(result).toEqual({ enqueuedCount: 2, failedCardIds: [] });
    expect(runMutation.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      { cardId: "card-1" },
      { cardId: "card-2" },
      { cardId: "card-3" },
    ]);
  });

  describe("per-card attempts", () => {
    const ctxFor = (card: unknown) => {
      const patch = mock(
        async (_table: string, _id: string, _value: unknown) => undefined
      );
      return {
        patch,
        ctx: {
          db: {
            get: mock(async () => card),
            patch,
            query: mock(() => ({
              withIndex: () => ({ unique: async () => null }),
            })),
            insert: mock(async () => "id"),
            replace: mock(async () => undefined),
            delete: mock(async () => undefined),
          },
          scheduler: { runAfter: mock(async () => null) },
        } as any,
      };
    };

    test("counts an attempt and starts the AI workflow for a card under the limit", async () => {
      const { enqueueAiBackfillCard } = await loadWorkflow();
      const { ctx, patch } = ctxFor({ _id: "c1", aiBackfillAttempts: 1 });

      const outcome = await enqueueAiBackfillCard(ctx, "c1" as any);

      expect(outcome).toBe("enqueued");
      expect(patch).toHaveBeenCalledWith("cards", "c1", {
        aiBackfillAttempts: 2,
      });
      expect(startWorkflow).toHaveBeenCalledTimes(1);
      expect(startWorkflow.mock.calls[0]?.[2]).toEqual({ cardId: "c1" });
    });

    test("stops retrying a card that used every attempt and takes it out of the backfill", async () => {
      const { enqueueAiBackfillCard, maxAttempts } = await loadWorkflow();
      const { ctx, patch } = ctxFor({
        _id: "c1",
        aiBackfillAttempts: maxAttempts,
        processingStatus: { classify: { status: "completed" } },
      });

      const outcome = await enqueueAiBackfillCard(ctx, "c1" as any);

      expect(outcome).toBe("exhausted");
      expect(startWorkflow).not.toHaveBeenCalled();
      const written = patch.mock.calls.find(
        (call) => call[0] === "cards"
      )?.[2] as any;
      expect(written.aiTags).toEqual([]);
      expect(written.processingStatus.classify).toEqual({
        status: "completed",
      });
      expect(written.processingStatus.metadata).toMatchObject({
        status: "failed",
        error: "ai_backfill_exhausted",
      });
    });

    test("skips a card that already has AI metadata or was deleted", async () => {
      const { enqueueAiBackfillCard } = await loadWorkflow();
      for (const card of [
        null,
        { _id: "c1", aiSummary: "done" },
        { _id: "c1", isDeleted: true },
      ]) {
        const { ctx, patch } = ctxFor(card);
        await expect(enqueueAiBackfillCard(ctx, "c1" as any)).resolves.toBe(
          "skipped"
        );
        expect(patch).not.toHaveBeenCalled();
      }
      expect(startWorkflow).not.toHaveBeenCalled();
    });
  });

  test("keeps enqueueing after a failure and reports the failed card", async () => {
    const { aiBackfillWorkflow } = await loadWorkflow();
    const runMutation = mock((_ref: unknown, args: { cardId: string }) =>
      args.cardId === "card-bad"
        ? Promise.reject(new Error("pipeline unavailable"))
        : Promise.resolve("enqueued")
    );
    const step = {
      runMutation,
      runQuery: mock(async () => [
        { cardId: "card-ok" },
        { cardId: "card-bad" },
      ]),
    };

    const result = await aiBackfillWorkflow.handler(step);

    expect(result).toEqual({ enqueuedCount: 1, failedCardIds: ["card-bad"] });
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  test("startAiBackfillWorkflow maps an async start to a workflow id", async () => {
    const { startAiBackfillWorkflow } = await loadWorkflow();

    const result = await startAiBackfillWorkflow.handler({}, {});

    expect(result).toEqual({ workflowId: "workflow-id" });
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(startWorkflow.mock.calls[0]?.[3]).toEqual({ startAsync: true });
  });

  test("startAiBackfillWorkflow returns the inline result for a sync start", async () => {
    const { startAiBackfillWorkflow } = await loadWorkflow();
    startWorkflow.mockImplementation(async () => ({
      enqueuedCount: 1,
      failedCardIds: [],
    }));

    const result = await startAiBackfillWorkflow.handler(
      {},
      { startAsync: false }
    );

    expect(result).toEqual({ enqueuedCount: 1, failedCardIds: [] });
    expect(startWorkflow.mock.calls[0]?.[3]).toEqual({ startAsync: false });
  });
});
