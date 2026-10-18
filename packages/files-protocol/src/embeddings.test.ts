import { expect, test } from "bun:test";
import {
  CARD_EMBEDDING_DIMENSIONS,
  CARD_EMBEDDING_MODEL,
  CARD_EMBEDDING_VERSION,
  cardEmbeddingDocument,
  cardEmbeddingQuery,
} from "./embeddings";

const EMBEDDING_FINGERPRINT = {
  sha256: "9e0da786afd507fc892aff12cbe96c784b8e8596f0c30f62b2397a2d587c579f",
  version: 1,
};

test("a new embedding model, prompt or text cut comes with a new embedding version", () => {
  const sample = `東京 🙂 ${"text ".repeat(400)}`;
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify({
        dimensions: CARD_EMBEDDING_DIMENSIONS,
        document: cardEmbeddingDocument(sample),
        model: CARD_EMBEDDING_MODEL,
        query: cardEmbeddingQuery(sample),
      })
    )
    .digest("hex");
  expect({ sha256, version: CARD_EMBEDDING_VERSION }).toEqual(
    EMBEDDING_FINGERPRINT
  );
});
