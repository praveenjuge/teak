import { describe, expect, test } from "bun:test";
import type { Doc, Id } from "../../_generated/dataModel";
import { classifyEmbeddingRow, LOST_EMBED_JOB_MS } from "../../embedding/state";

const NOW = 10 * LOST_EMBED_JOB_MS;

const row = (
  fields: Partial<Doc<"cardEmbeddings">>
): Doc<"cardEmbeddings"> => ({
  _creationTime: 0,
  _id: "row" as Id<"cardEmbeddings">,
  cardId: "card" as Id<"cards">,
  userId: "user",
  ...fields,
});

describe("classifyEmbeddingRow", () => {
  test.each([
    ["no row is missing", null, "missing"],
    ["a row with no hash is missing", row({}), "missing"],
    ["a row with a hash is embedded", row({ hash: "h" }), "embedded"],
    [
      "a row whose embed ran out of retries failed",
      row({ lastError: "x" }),
      "failed",
    ],
    [
      "a failed re-embed that kept its old hash failed",
      row({ hash: "old", lastError: "x" }),
      "failed",
    ],
    ["a row due recently is pending", row({ dueAt: NOW - 1000 }), "pending"],
    [
      "a row due over an hour ago lost its job",
      row({ dueAt: NOW - LOST_EMBED_JOB_MS - 1 }),
      "lost_job",
    ],
    [
      "a tombstoned row is deleting",
      row({ dueAt: NOW, pendingVectorDeleteAt: NOW }),
      "deleting",
    ],
  ] as const)("%s", (_name, input, expected) => {
    expect(classifyEmbeddingRow(input, NOW)).toBe(expected);
  });
});
