import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { scanCardsWithBaseQuery } from "../../publicApi/search";

const ctxWhosePageFails = (error: unknown) => {
  const query = {
    filter: () => query,
    order: () => query,
    paginate: () => Promise.reject(error),
    withIndex: () => query,
  };
  return { db: { query: () => query } } as unknown as QueryCtx;
};

const scan = (error: unknown, options: { folderId?: Id<"folders"> } = {}) =>
  scanCardsWithBaseQuery(
    ctxWhosePageFails(error),
    "user_1" as never,
    options,
    { mode: "list", page: "convex-page" },
    50
  );

const cursorRefusal = {
  data: {
    code: "INVALID_INPUT",
    message: "Query parameter `cursor` is invalid",
  },
};

describe("scanning cards for the public API", () => {
  test.each([
    ["the card list", {}],
    ["a folder", { folderId: "folder_1" as Id<"folders"> }],
  ])(
    "a cursor Convex can't parse is refused as a bad cursor in %s",
    async (_name, options) => {
      await expect(
        scan(new Error("InvalidCursor: Failed to parse cursor"), options)
      ).rejects.toMatchObject(cursorRefusal);
    }
  );

  test.each([
    ["the card list", {}],
    ["a folder", { folderId: "folder_1" as Id<"folders"> }],
  ])(
    "any other read failure in %s is passed on, not called a bad cursor",
    async (_name, options) => {
      const failure = new Error("Too many documents read in a single function");
      const rejection = await scan(failure, options).catch((error) => error);
      expect(rejection).toBe(failure);
      expect(rejection).not.toBeInstanceOf(ConvexError);
    }
  );
});
