import { describe, expect, mock, test } from "bun:test";
import {
  patchCardForUser,
  resolveCardIdForUserRequest,
} from "../../publicApi/cardsForUser";
import {
  withMappedOwner,
  withSearchSyncDb,
} from "../helpers/session.test-utils";

const runHandler = (fn: any, ctx: any, args: any) => {
  const handler = (fn as any).handler ?? fn;
  return handler(withMappedOwner(ctx), args);
};

describe("public API cards for user", () => {
  test("patchCardForUser forwards provided fields and returns updated card", async () => {
    const patchCalls: Record<string, unknown>[] = [];

    const ctx = {
      db: withSearchSyncDb({
        get: async () => ({
          _id: "card_1",
          userId: "user_1",
          type: "text",
          content: "old",
          aiPending: true,
        }),
        patch: (_table: string, _id: string, payload: unknown) => {
          patchCalls.push(payload as Record<string, unknown>);
          return null;
        },
      }),
      storage: {
        getUrl: async () => null,
      },
      scheduler: {
        runAfter: async () => null,
      },
    } as any;

    const result = await runHandler(patchCardForUser, ctx, {
      userId: "user_1",
      cardId: "card_1",
      notes: null,
      tags: [],
    });

    expect(result?._id).toBe("card_1");
    expect(result?.userId).toBe("user_1");
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]).toMatchObject({ notes: undefined, tags: undefined });
  });

  test("patchCardForUser enqueues processing once for multi-field updates", async () => {
    const patchCalls: Record<string, unknown>[] = [];
    const runAfter = mock().mockResolvedValue(null);

    const ctx = {
      db: withSearchSyncDb({
        get: async () => ({
          _id: "card_1",
          _creationTime: 1,
          aiPending: true,
          userId: "user_1",
          type: "text",
          content: "old content",
          url: "https://old.example.com",
          urlHost: "old.example.com",
          urlKey: "old.example.com/",
          createdAt: 1,
          updatedAt: 1,
        }),
        patch: (_table: string, _id: string, payload: unknown) => {
          patchCalls.push(payload as Record<string, unknown>);
          return null;
        },
      }),
      storage: {
        getUrl: async () => null,
      },
      scheduler: {
        runAfter,
      },
      runMutation: mock().mockResolvedValue({ ok: true }),
      runQuery: mock().mockResolvedValue({ ok: true }),
    } as any;

    await runHandler(patchCardForUser, ctx, {
      userId: "user_1",
      cardId: "card_1",
      content: "new content",
      url: "https://new.example.com",
    });

    expect(patchCalls).toEqual([
      expect.objectContaining({
        content: "new content",
        url: "https://new.example.com",
      }),
      { processingRev: 1 },
    ]);
    const queued = ctx.db.insert.mock.calls.filter(
      ([table]: [string]) => table === "workflowDispatches"
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.[1]).toMatchObject({
      cardId: "card_1",
      kind: "cardProcessing",
      reset: true,
      rev: 1,
    });
  });

  test("resolveCardIdForUserRequest normalizes card id", async () => {
    const ctx = {
      db: withSearchSyncDb({
        normalizeId: (_table: string, id: string) =>
          id === "valid" ? "card_1" : null,
      }),
    } as any;

    expect(
      await runHandler(resolveCardIdForUserRequest, ctx, { cardId: "valid" })
    ).toBe("card_1");
    expect(
      await runHandler(resolveCardIdForUserRequest, ctx, { cardId: "invalid" })
    ).toBeNull();
  });
});
