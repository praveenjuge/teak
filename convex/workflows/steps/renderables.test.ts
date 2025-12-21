import { describe, expect, it } from "bun:test";
import { generateHandler } from "./renderables";

describe("renderables step", () => {
  const createMockFn = <TArgs extends unknown[], TResult>(
    impl: (...args: TArgs) => TResult | Promise<TResult>
  ) => {
    const calls: TArgs[] = [];
    const fn = (async (...args: TArgs) => {
      calls.push(args);
      return impl(...args);
    }) as ((...args: TArgs) => Promise<TResult>) & { calls: TArgs[] };
    fn.calls = calls;
    return fn;
  };

  it("marks renderables as failed when thumbnail generation fails", async () => {
    const runMutation = createMockFn<[any, any], null>(async () => null);
    const mockCtx = {
      runQuery: createMockFn<[any, any], any>(async () => ({
        _id: "card123",
        type: "image",
        fileId: "file123",
        processingStatus: {},
      })),
      runAction: createMockFn<[any, any], any>(async () => ({
        success: false,
        generated: false,
        error: "kernel_execution_failed",
      })),
      runMutation,
    };

    const result = await generateHandler(mockCtx, { cardId: "card123", cardType: "image" });

    expect(result.success).toBe(false);
    expect(result.thumbnailGenerated).toBe(false);
    expect(runMutation.calls.length).toBe(1);

    const mutationArgs = runMutation.calls[0]?.[1] as any;
    expect(mutationArgs).toBeDefined();
    expect(mutationArgs?.processingStatus.renderables.status).toBe("failed");
    expect(mutationArgs?.processingStatus.renderables.error).toBe(
      "kernel_execution_failed"
    );
  });

  it("marks renderables as completed when thumbnail generation is skipped", async () => {
    const runMutation = createMockFn<[any, any], null>(async () => null);
    const mockCtx = {
      runQuery: createMockFn<[any, any], any>(async () => ({
        _id: "card456",
        type: "image",
        fileId: "file456",
        processingStatus: {},
      })),
      runAction: createMockFn<[any, any], any>(async () => ({
        success: true,
        generated: false,
      })),
      runMutation,
    };

    const result = await generateHandler(mockCtx, { cardId: "card456", cardType: "image" });

    expect(result.success).toBe(true);
    expect(result.thumbnailGenerated).toBe(false);
    expect(runMutation.calls.length).toBe(1);

    const mutationArgs = runMutation.calls[0]?.[1] as any;
    expect(mutationArgs).toBeDefined();
    expect(mutationArgs?.processingStatus.renderables.status).toBe("completed");
  });
});
