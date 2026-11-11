import { describe, expect, test } from "bun:test";
import { type Page, readAllPages } from "../../admin/pages";

const pages = (count: number) => {
  const read: (string | null)[] = [];
  const readPage = (cursor: string | null): Promise<Page<number>> => {
    read.push(cursor);
    const index = cursor === null ? 0 : Number(cursor);
    return Promise.resolve({
      rows: [index * 10, index * 10 + 1],
      isDone: index === count - 1,
      continueCursor: String(index + 1),
    });
  };
  return { read, readPage };
};

describe("readAllPages", () => {
  test("follows each page's cursor to the last page", async () => {
    const { read, readPage } = pages(3);
    expect(await readAllPages(readPage, 10)).toEqual({
      rows: [0, 1, 10, 11, 20, 21],
      isComplete: true,
    });
    expect(read).toEqual([null, "1", "2"]);
  });

  test("stops at the page budget and says the rows are incomplete", async () => {
    const { readPage } = pages(5);
    expect(await readAllPages(readPage, 2)).toEqual({
      rows: [0, 1, 10, 11],
      isComplete: false,
    });
  });
});
