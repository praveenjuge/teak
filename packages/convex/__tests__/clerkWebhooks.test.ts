// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

const verifyWebhookMock = mock();

mock.module("@clerk/backend/webhooks", () => ({
  verifyWebhook: verifyWebhookMock,
}));

describe("clerkWebhooks.ts", () => {
  let handleClerkUserWebhookRequest: any;

  beforeEach(async () => {
    process.env.CLERK_WEBHOOK_SECRET = "whsec_test";
    verifyWebhookMock.mockReset();
    ({ handleClerkUserWebhookRequest } = await import("../clerkWebhooks"));
  });

  test("upserts mappings for user.created events", async () => {
    verifyWebhookMock.mockResolvedValue({
      type: "user.created",
      data: {
        id: "user_123",
        primary_email_address_id: "email_1",
        email_addresses: [{ id: "email_1", email_address: "user@example.com" }],
      },
    });

    const ctx = {
      runMutation: mock().mockResolvedValue(null),
    };

    const response = await handleClerkUserWebhookRequest(
      ctx,
      new Request("https://example.com/api/clerk/webhooks/user", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      })
    );

    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      clerkId: "user_123",
      email: "user@example.com",
    });
    expect(response.status).toBe(200);
  });

  test("rejects invalid webhook signatures", async () => {
    verifyWebhookMock.mockRejectedValue(new Error("invalid signature"));

    const ctx = {
      runMutation: mock(),
    };

    const response = await handleClerkUserWebhookRequest(
      ctx,
      new Request("https://example.com/api/clerk/webhooks/user", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      })
    );

    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });
});
