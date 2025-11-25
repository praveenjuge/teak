import "../../../../types/bun-test";
import { describe, expect, it } from "bun:test";
import { classifyStep } from "./index";

describe("categorization classifyStep", () => {
  it("maps link cards via deterministic resolver", async () => {
    const action =
      (classifyStep as any).handler ||
      (classifyStep as any)._handler ||
      (classifyStep as any);

    const mockCtx = {
      runQuery: async (_ref: any, { cardId }: any) => ({
        _id: cardId,
        type: "link",
        url: "https://github.com/teak/example",
        metadata: {},
      }),
    };

    expect(typeof action).toBe("function");
    const result = await action(mockCtx, { cardId: "card_123" });

    expect(result.mode).toBe("classified");
    expect(result.classification?.category).toBe("software");
    expect(result.classification?.confidence).toBeGreaterThan(0.5);
    expect(result.classification?.reason).toBeDefined();
  });
});
