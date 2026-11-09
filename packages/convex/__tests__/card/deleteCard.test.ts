import { describe, expect, mock, test } from "bun:test";
import { permanentDeleteCard } from "../../card/deleteCard";
import { withTestSession } from "../helpers/session.test-utils";

// What a permanent delete removes and queues is covered against the real
// database in edge/card/emptyTrash.test.ts.
describe("card/deleteCard.ts", () => {
  test("throws when unauthenticated", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any);
    const handler = (permanentDeleteCard as any).handler ?? permanentDeleteCard;
    await expect(handler(ctx, { id: "c1" })).rejects.toThrow(
      "User must be authenticated"
    );
  });
});
