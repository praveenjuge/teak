import { describe, expect, mock, test } from "bun:test";
import { sha256Hex } from "@teak/files-protocol";
import { type FunctionReference, getFunctionName } from "convex/server";
import { internal } from "../../../_generated/api";
import { mockActionCtx } from "../../helpers/convex.test-utils";
import { callPublicApi } from "../../helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "../../helpers/session.test-utils";

const API_KEY = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
const BEGIN = getFunctionName(
  internal.idempotency.beginIdempotencyRequestForUser
);
const VALIDATE_KEY = getFunctionName(internal.apiKeys.validateUserApiKey);

// Answers by function, and reports every request an idempotency key
// reserves; the reservation is refused as a conflict so nothing else runs.
const backendRecordingReservations = () => {
  const reserved: Record<string, unknown>[] = [];
  const runMutation = mock((ref: FunctionReference<"mutation">, args) => {
    const name = getFunctionName(ref);
    if (name === VALIDATE_KEY) {
      return Promise.resolve({
        access: "full_access",
        keyId: "key_1",
        rateLimit: { ok: true },
        rateLimitKey: "component:key_1",
        source: "component",
        userId: "user_1",
      });
    }
    if (name === BEGIN) {
      reserved.push(args as Record<string, unknown>);
      return Promise.resolve({ status: "conflict" });
    }
    return Promise.resolve(null);
  });
  return {
    ctx: mockActionCtx(
      withMappedOwner({ runMutation, runQuery: mock() } as never)
    ),
    reserved,
  };
};

describe("Idempotency-Key", () => {
  // Stored keys hash the request with these paths: a retry made before a
  // change to them must still match the request it repeats.
  test.each([
    ["/v1/cards", { content: "hello" }, { content: "hello" }],
    [
      "/v1/cards/bulk",
      { items: [{ cardId: "c1" }], operation: "delete" },
      { items: [{ cardId: "c1" }], operation: "delete" },
    ],
  ])("a POST to %s is reserved under that path", async (path, body, hashed) => {
    const { ctx, reserved } = backendRecordingReservations();

    const response = await callPublicApi(ctx, {
      body,
      headers: { Authorization: `Bearer ${API_KEY}`, "Idempotency-Key": "k1" },
      method: "POST",
      path,
    });

    expect(response.status).toBe(409);
    expect(reserved).toEqual([
      {
        keyHash: await sha256Hex("user_1:k1"),
        method: "POST",
        path,
        requestHash: await sha256Hex(
          JSON.stringify({ body: hashed, method: "POST", path })
        ),
        userId: "user_1",
      },
    ]);
  });
});
