import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { QueryCtx } from "../../_generated/server";
import { searchBranch, withReadMeter } from "../../search/readMeter";

const doc = (id: string, text = "") => ({ _id: id, text });

const fakeDb = () => {
  const rows = [
    doc("a", "x".repeat(100)),
    doc("b"),
    { ...doc("c"), metadata: { size: 12n } },
  ];
  const query = {
    withIndex: () => query,
    order: () => query,
    take: (n: number) => Promise.resolve(rows.slice(0, n)),
    paginate: () =>
      Promise.resolve({ page: rows, isDone: true, continueCursor: "" }),
    async *[Symbol.asyncIterator]() {
      yield* rows;
    },
  };
  return {
    get: (id: string) => Promise.resolve(rows.find((row) => row._id === id)),
    query: () => query,
  };
};

const logged = () => {
  const spy = spyOn(console, "log").mockImplementation(() => undefined);
  return {
    lines: () =>
      spy.mock.calls
        .filter(([tag]) => tag === "[search/readMeter]")
        .map(([, line]) => JSON.parse(String(line))),
  };
};

afterEach(() => {
  (console.log as unknown as { mockRestore?: () => void }).mockRestore?.();
});

describe("search read meter", () => {
  test("counts every document a search reads, however it reads them", async () => {
    const log = logged();
    const ctx = { db: fakeDb() } as unknown as QueryCtx;

    const result = await withReadMeter(ctx, "text", async (metered) => {
      const db = metered.db as unknown as ReturnType<typeof fakeDb>;
      await db.query().withIndex().take(2);
      await db.query().order().paginate();
      await db.get("c");
      for await (const _row of db.query()) {
        // read every row
      }
      return "done";
    });

    expect(result).toBe("done");
    expect(log.lines()).toEqual([
      { branch: "text", returnedDocs: 9, returnedBytes: expect.any(Number) },
    ]);
    expect(log.lines()[0].returnedBytes).toBeGreaterThan(300);
  });

  test("still logs when the search throws", async () => {
    const log = logged();
    const ctx = { db: fakeDb() } as unknown as QueryCtx;

    await expect(
      withReadMeter(ctx, "list", () => Promise.reject(new Error("too broad")))
    ).rejects.toThrow("too broad");
    expect(log.lines()).toEqual([
      { branch: "list", returnedDocs: 0, returnedBytes: 0 },
    ]);
  });

  test.each([
    [{ searchQuery: " mood:calm" }, "like"],
    [{ searchQuery: "design" }, "text"],
    [{ searchQuery: "text:receipt" }, "text"],
    [{ searchQuery: "tag:ui" }, "tag"],
    [{ searchQuery: "folder:Inbox" }, "folder"],
    [{ searchQuery: "  ", tag: "ui" }, "tag"],
    [{ folderId: "f1" }, "folder"],
    [{ folderQuery: "Inbox" }, "folder"],
    [{ sort: "shuffle" }, "shuffle"],
    [{}, "list"],
  ] as const)("labels %p as %s", (args, branch) => {
    expect(searchBranch(args)).toBe(branch);
  });
});
