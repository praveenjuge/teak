import { describe, expect, mock, test } from "bun:test";
import {
  deleteAccountDataHandler,
  type OwnedCardIds,
} from "../../accountDeletion/cards";

const ids = (...cardIds: string[]) => cardIds as unknown as OwnedCardIds;

// Convex's delete errors and read sets can't be reproduced in convex-test,
// so these stand in a fake database for them.
describe("deleteAccountDataHandler", () => {
  test("does not read the cards table while deleting, so concurrent card writes cannot fail the batch", async () => {
    const ctx = {
      db: {
        get: mock((table: string) => {
          if (table === "cards") {
            throw new Error("cards read would widen the OCC read set");
          }
          return null;
        }),
        query: (table: string) => ({
          withIndex: (_name: any, cb: any) => {
            let _cardId: string | undefined;
            if (cb) {
              cb({
                eq: (_field: string, value: string) => {
                  _cardId = value;
                },
              });
            }
            return {
              ...(table === "cardSearchDocuments"
                ? { unique: async () => ({ _id: "search_c1" }) }
                : {}),
              ...(table === "cardSearchTags"
                ? { take: async () => [{ _id: `tag_${_cardId}` }] }
                : {}),
              ...(table === "cardTextContents" ? { take: async () => [] } : {}),
              ...(table === "folderRuleApplications" ||
              table === "folderRuleRunChanges"
                ? { take: async () => [] }
                : {}),
              ...(table === "folderCards" ? { take: async () => [] } : {}),
              ...(table === "cardSearchTagSyncStates"
                ? { unique: async () => ({ _id: `tag_state_${_cardId}` }) }
                : {}),
            };
          },
        }),
        delete: mock(),
      },
    } as any;

    const result = await deleteAccountDataHandler(ctx, ids("c1", "c2"));

    expect(result).toBe(2);
    expect(ctx.db.get).not.toHaveBeenCalledWith("cards", "c1");
    expect(ctx.db.get).not.toHaveBeenCalledWith("cards", "c2");
    expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
    expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c2");
  });

  test("skips the production nonexistent-document delete error", async () => {
    const ctx = {
      db: {
        get: mock(() => {
          throw new Error("cards read would widen the OCC read set");
        }),
        query: (table: string) => ({
          withIndex: (_name: any, cb: any) => {
            let _cardId: string | undefined;
            if (cb) {
              cb({
                eq: (_field: string, value: string) => {
                  _cardId = value;
                },
              });
            }
            return {
              ...(table === "cardSearchDocuments"
                ? { unique: async () => null }
                : {}),
              ...(table === "cardSearchTags" ? { take: async () => [] } : {}),
              ...(table === "cardTextContents" ? { take: async () => [] } : {}),
              ...(table === "folderRuleApplications" ||
              table === "folderRuleRunChanges"
                ? { take: async () => [] }
                : {}),
              ...(table === "folderCards" ? { take: async () => [] } : {}),
              ...(table === "cardSearchTagSyncStates"
                ? { unique: async () => null }
                : {}),
            };
          },
        }),
        delete: mock((table: string, id: string) => {
          if (table === "cards" && id === "c1") {
            // Verbatim production Convex backend wording (no hyphen).
            throw new Error('Delete on nonexistent document ID "c1"');
          }
        }),
      },
    } as any;

    const result = await deleteAccountDataHandler(ctx, ids("c1", "c2"));

    expect(result).toBe(1);
    expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
    expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c2");
  });

  test("rethrows unexpected card deletion failures", async () => {
    const ctx = {
      db: {
        get: mock(() => null),
        query: (table: string) => ({
          withIndex: (_name: any, cb: any) => {
            if (cb) {
              cb({ eq: () => undefined });
            }
            return {
              ...(table === "cardSearchDocuments"
                ? { unique: async () => null }
                : {}),
              ...(table === "cardSearchTags" ? { take: async () => [] } : {}),
              ...(table === "cardTextContents" ? { take: async () => [] } : {}),
              ...(table === "folderRuleApplications" ||
              table === "folderRuleRunChanges"
                ? { take: async () => [] }
                : {}),
              ...(table === "folderCards" ? { take: async () => [] } : {}),
              ...(table === "cardSearchTagSyncStates"
                ? { unique: async () => null }
                : {}),
            };
          },
        }),
        delete: mock(() => {
          throw new Error("Connection lost to backend");
        }),
      },
    } as any;

    await expect(deleteAccountDataHandler(ctx, ids("c1"))).rejects.toThrow(
      "Connection lost to backend"
    );
  });
});
