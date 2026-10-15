# Semantic search

Cards get text embeddings from Workers AI. The vectors live in Cloudflare
Vectorize, one namespace per user, so search can match meaning as well as
words. This note records the model choice and the index layout. The constants
live in `packages/files-protocol/src/embeddings.ts`.

## Model: `@cf/google/embeddinggemma-300m`

- 768 dimensions, cosine.
- Up to 512 input tokens. Workers AI does not document what happens past
  that, so `truncateForEmbedding` cuts text to an estimated 480 tokens (a
  third of a token per ASCII character, 1.2 per other character). English
  keeps about 1,440 characters.
- It is a Beta model on Workers AI.

Workers AI embeds text exactly as given, so the code adds EmbeddingGemma's
retrieval prompts itself:

- queries: `task: search result | query: …`
- cards: `title: none | text: …`

### Evaluation

The test set was 38 seeded dev cards, embedded as title, description, content,
AI summary and tags. It had 33 paraphrased queries with hand-marked relevant
cards. Five queries were in other languages (Spanish, German, Hindi, Japanese)
or crossed languages. Each model used its own documented query and card
prompts. The models ran from their open weights on CPU, since Workers AI hosts
the same weights.

| Model | Dims | Recall@5 | MRR | nDCG@10 |
| --- | --- | --- | --- | --- |
| bge-base-en-v1.5 (baseline) | 768 | 0.856 | 0.799 | 0.804 |
| bge-m3 | 1024 | 0.965 | 0.891 | 0.898 |
| embeddinggemma-300m | 768 | 0.977 | 0.965 | 0.958 |
| qwen3-embedding-0.6b | 1024 | 0.977 | 0.940 | 0.941 |

EmbeddingGemma ranked every query's first relevant card in the top 3. The
English-only baseline missed most of the non-English queries.
qwen3-embedding-0.6b came close and takes inputs up to 4,096 tokens. We chose
EmbeddingGemma for its accuracy and its smaller vectors, and accepted two
costs: it is a Beta model, and its 512-token input cuts long cards to their
title, summary and opening. The set is small, so treat small differences as
noise.

Changing the model changes the dimensions. That needs a new index and a
re-embed of every card. Bump `CARD_EMBEDDING_VERSION` for any change to the
model, the prompts or the text a card is embedded from.

## Index and shards

- Each shard is one Vectorize index: `teak-cards-<shard>`, 768 dimensions,
  cosine, with no metadata indexes.
- Each index is bound in the Files Worker as `CARD_VECTORS_<shard>`.
- Shard 0 is `teak-cards-0`, created in the dashboard under Storage &
  Databases → Vectorize.
- Each user is one namespace, named by their Teak user ID (Vectorize allows
  at most 64 bytes).
- One index holds up to 50,000 namespaces and 20 million vectors.

`vectorShards` in Convex records each user's shard
(`packages/convex/vectorShards.ts`):

- A user stays on the shard they were first placed on.
- New users go to `CURRENT_VECTOR_SHARD`.
- Adding capacity means creating `teak-cards-1`, binding it, and moving
  `CURRENT_VECTOR_SHARD`.
- Account deletion removes the row.

The Files Worker's `capabilities` op reports `vectors` when shard 0 is bound.

## Keeping vectors in step with cards

The `cardEmbeddings` table in Convex is the ledger: one row per card that has,
or is due for, a vector (`packages/convex/embedding/`).

- **What is embedded.** `buildEmbeddingText` joins the title, description, AI
  summary, user and AI tags, notes, visual styles, and the first 2,000
  characters of the body (content, extracted document text, or transcript).
- **When.** The search sync (`card/searchDocumentHelpers.ts`) marks a card
  whenever its searchable text changes, including AI metadata writes, so card
  processing has no embedding step and an embedding failure never fails a
  card. A mark sets `dueAt` 30 seconds out and schedules `embedDue`; later
  edits push `dueAt` back, so a burst of edits costs one embedding.
- **Skipping.** The row stores a SHA-256 of `CARD_EMBEDDING_VERSION` and the
  text. An unchanged hash records the row without a Workers AI call.
- **Fencing.** A job records its result only if `dueAt` still holds the value
  it read. An older job never marks a newer edit done: an edit made while a
  job ran is handed to a new job, and a job whose vector may have overwritten
  a newer one clears the hash so the current text is embedded again.
- **Failures.** A failed embed retries with backoff (30 s doubling) five
  times, then keeps `attempts` and `lastError` for the backfill.
- **Empty text.** A card cleared of every field has its vector deleted.
- **Deletion.** Deleting a card tombstones its row (`pendingVectorDeleteAt`)
  and deletes the vector; the row goes only after the delete succeeds, and a
  delete that keeps failing leaves the tombstone. A card deleted mid-embed has
  the vector it just wrote deleted. Account deletion deletes the account's
  vectors and rows before finishing.
- **Dev.** Namespaces carry the deployment's R2 key prefix, so the dev
  deployment's cards live in `dev/<userId>` namespaces of the same index.
- **No Files Worker.** Without `FILES_BASE` (the local E2E stack) nothing is
  marked or written.

Cards saved before embeddings shipped, and cards whose retries ran out, are
left to the backfill.
