import { beforeEach, describe, expect, mock, test } from "bun:test";

const startWorkflow = mock(
  async (_ctx: unknown, _ref: unknown, _args: unknown) => "workflow-id"
);

mock.module("../../workflows/manager", () => ({
  startWorkflow,
  workflow: { define: (config: unknown) => config },
}));

const loadWorkflow = async () => {
  const module = await import("../../workflows/aiBackfill");
  return {
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

  test("enqueues every candidate through the AI metadata workflow", async () => {
    const { aiBackfillWorkflow } = await loadWorkflow();
    const runMutation = mock(async () => undefined);
    const step = {
      runMutation,
      runQuery: mock(async () => [{ cardId: "card-1" }, { cardId: "card-2" }]),
    };

    const result = await aiBackfillWorkflow.handler(step);

    expect(result).toEqual({ enqueuedCount: 2, failedCardIds: [] });
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      cardId: "card-1",
      startAsync: true,
    });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({
      cardId: "card-2",
      startAsync: true,
    });
  });

  test("keeps enqueueing after a failure and reports the failed card", async () => {
    const { aiBackfillWorkflow } = await loadWorkflow();
    const runMutation = mock((_ref: unknown, args: { cardId: string }) =>
      args.cardId === "card-bad"
        ? Promise.reject(new Error("pipeline unavailable"))
        : Promise.resolve()
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
