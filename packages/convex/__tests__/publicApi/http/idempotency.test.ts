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
const RELEASE = getFunctionName(
  internal.idempotency.releaseIdempotencyRequestForUser
);
const TRACK = getFunctionName(
  internal.idempotencyAnalytics.trackIdempotencyOutcome
);
const QUICK_SAVE = getFunctionName(
  internal.publicApi.cardsForUser.quickSaveForUser
);
const VALIDATE_KEY = getFunctionName(internal.apiKeys.validateUserApiKey);

// Answers by function and records every mutation it is sent. The key is
// reserved with `reservation`; a name in `failing` throws.
const backend = ({
  failing = [],
  reservation = { status: "conflict" },
}: {
  failing?: string[];
  reservation?: Record<string, unknown>;
} = {}) => {
  const calls: { args: Record<string, unknown>; name: string }[] = [];
  const runMutation = mock((ref: FunctionReference<"mutation">, args) => {
    const name = getFunctionName(ref);
    calls.push({ args: args as Record<string, unknown>, name });
    if (failing.includes(name)) {
      return Promise.reject(new Error(`${name} failed`));
    }
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
      return Promise.resolve(reservation);
    }
    return Promise.resolve(null);
  });
  return {
    calls: (name: string) =>
      calls.filter((call) => call.name === name).map((call) => call.args),
    ctx: mockActionCtx(
      withMappedOwner({ runMutation, runQuery: mock() } as never)
    ),
  };
};

const createWithKey = (ctx: ReturnType<typeof backend>["ctx"]) =>
  callPublicApi(ctx, {
    body: { content: "hello" },
    headers: { Authorization: `Bearer ${API_KEY}`, "Idempotency-Key": "k1" },
    method: "POST",
    path: "/v1/cards",
  });

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
    const { calls, ctx } = backend();

    const response = await callPublicApi(ctx, {
      body,
      headers: { Authorization: `Bearer ${API_KEY}`, "Idempotency-Key": "k1" },
      method: "POST",
      path,
    });

    expect(response.status).toBe(409);
    expect(calls(BEGIN)).toEqual([
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

  test("a failed analytics write doesn't change the answer", async () => {
    const { ctx } = backend({ failing: [TRACK] });

    const response = await createWithKey(ctx);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
  });

  test("a failed analytics write doesn't keep the key reserved when the save fails", async () => {
    const { calls, ctx } = backend({
      failing: [TRACK, QUICK_SAVE],
      reservation: { record: { leaseToken: "lease_1" }, status: "started" },
    });

    const response = await createWithKey(ctx);

    expect(response.status).toBe(500);
    expect(calls(RELEASE)).toEqual([
      expect.objectContaining({
        keyHash: await sha256Hex("user_1:k1"),
        leaseToken: "lease_1",
      }),
    ]);
  });
});
