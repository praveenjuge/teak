// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { withTestSession } from "../helpers/session.test-utils";

describe("ai/actions.ts", () => {
  let manuallyGenerateAI: any;

  beforeEach(async () => {
    manuallyGenerateAI = (await import("../../ai/actions")).manuallyGenerateAI;
  });

  test("throws when unauthenticated", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any);
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;
    await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
      "Authentication required"
    );
  });

  test("delegates to the reprocess mutation for the signed-in owner", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      runQuery: mock().mockResolvedValue(null),
      runMutation: mock().mockResolvedValue({ cardId: "c1", requestedAt: 1 }),
    } as any);
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(result).toEqual({ success: true });
    expect(ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      cardId: "c1",
      userId: "u1",
    });
  });

  test("passes the reprocess limit error through", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      runQuery: mock().mockResolvedValue(null),
      runMutation: mock().mockRejectedValue(
        new Error("This card is already refreshing")
      ),
    } as any);
    const handler = (manuallyGenerateAI as any).handler ?? manuallyGenerateAI;
    await expect(handler(ctx, { cardId: "c1" })).rejects.toThrow(
      "This card is already refreshing"
    );
  });
});
