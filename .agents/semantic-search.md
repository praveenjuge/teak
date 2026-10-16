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
  cosine, with one string metadata index, `type`.
- Each index is bound in the Files Worker as `CARD_VECTORS_<shard>`.
- Shard 0 is `teak-cards-0`, created in the dashboard under Storage &
  Databases → Vectorize.
- Each vector carries its card's type as `type` metadata. A new shard needs
  the metadata index before its first vector, since Vectorize indexes only
  vectors upserted after the index exists:
  `npx wrangler vectorize create-metadata-index teak-cards-<shard> --property-name=type --type=string`.
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
- **Skipping.** The row stores a SHA-256 of `CARD_EMBEDDING_VERSION`, the
  card type and the text. An unchanged hash records the row without a
  Workers AI call. A type change alone marks the card too, so its vector's
  `type` stays current.
- **Fencing.** A job records its result only if `dueAt` still holds the value
  it read. An older job never marks a newer edit done: an edit made while a
  job ran is handed to a new job. A stale job that wrote a vector clears the
  hash, because the index may no longer hold the hashed text, so the current
  text is embedded again.
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

## Backfill

`migration/backfillEmbeddings.ts` queues every card that has text and no
current vector:
- cards saved before embeddings shipped
- cards whose retries ran out
- cards whose job was lost (due over an hour ago)

It pages `cards` 100 at a time and skips accounts being deleted. It queues
cards in jobs of 16, one job every 3.2 s (about 300 a minute), and each job
embeds its cards in one `embed-upsert`. Vectorize answers many small writes
with 429 (`VECTOR_UPSERT_ERROR`, code 40041), so batch writes wherever many
cards change at once. It's a dry run by default:

```bash
npx convex run migration/backfillEmbeddings:backfillEmbeddings
npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"dryRun":false,"userId":"teak_…"}'
npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"dryRun":false}'
```

`userId` limits a run to one account, as a canary. Don't run the whole table
on the dev deployment: it shares the production index, and every dev account
it embeds takes one of the index's 50,000 namespaces.

The last batch logs `backfillEmbeddings finished` with the totals. `once` and
`cursor` run one batch at a time. After bumping `CARD_EMBEDDING_VERSION`, add
`"reembed": true` to queue embedded cards too. A card whose text is
unchanged costs no Workers AI call.

### Type metadata

Vectors written before the `type` metadata (October 2026) have none, so a
type filter never matches them. Their rows hash without the type, so
`"reembed": true` writes every one again with it. Once the Files Worker that
writes types is live and `teak-cards-0` has the `type` metadata index:

```bash
npx wrangler vectorize list-metadata-index teak-cards-0
npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"reembed":true}'
npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"dryRun":false,"reembed":true,"userId":"teak_…"}'
npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"dryRun":false,"reembed":true}'
```

The dry run's `embedded` count is the number of cards a real run writes
again. After the canary, try a `mood:` search on that account before the
whole table. Until a vector is written again,
`mood:` still finds it the old way (below).

## Weekly ledger sweep

The Monday `sweep-orphaned-objects` cron first runs
`embedding/sweep:sweepVectorLedger`. It reports, and never changes:
- vector deletes still pending after 24 hours
- rows whose card is gone without a tombstone
- embeds that ran out of retries
- embeds due over an hour ago with no job

It logs `vectors.ledger_clean`, `vectors.ledger_problems_detected`, or
`vectors.ledger_sweep_incomplete` (when its 500,000-row cap stops it) with the
counts and up to 10 card ids. A failed re-embed of an edited card counts as a
failed embed: it keeps the vector of the old text. The backfill re-queues
failed embeds and lost jobs. The storage sweep in the same cron runs even if
this one fails.

## Hybrid search

Every search blends keyword and meaning matches (`mode` `hybrid`, the
default; `keyword` and `semantic` for one side). The pure parts are in
`packages/convex/shared/search/semantic.ts`; the Convex parts in
`packages/convex/search/`.

- **When.** Only a search with free words of 2 or more characters
  (`semanticQueryText`: words and phrases, lowercased, without qualifiers or
  `#hex` colors, at most 500 characters). A qualifier-only search makes no
  vector call.
- **Cache.** `semanticSearchResults` holds each user's ranking per search
  (up to 100 `{cardId, score}`) for 10 minutes. `key` is a SHA-256 of
  `CARD_EMBEDDING_VERSION` and the text, so the search text is never stored.
  The hourly `cleanup-semantic-search-cache` cron removes expired rows, and
  account deletion removes the user's rows. Queries read a row until it is
  removed; the action and the API refetch an expired one.
- **Grid.** Queries can't call the worker. The web grid calls the
  `search/semanticActions:requestSemanticResults` action beside its
  `searchCardsPaginated` query; the action fills the cache and the reactive
  query merges the ranking in when it lands. Until then the grid is
  keyword-only, and an empty result waits up to 1.5 s before "No cards found".
  The native apps' query reads the same cache but nothing fills it for them
  yet.
- **API.** `GET /v1/cards` fetches the ranking (cache first, 1.5 s timeout)
  before it reads a page, and passes it to the page query. Each page fetches
  it again, and match cursors resume after the last card served, so a ranking
  that changes between pages can't repeat cards. `searchMode` says which mode
  ran.
- **Fusion.** Reciprocal rank fusion (`1 / (60 + rank)` from each side).
  Meaning-only matches below `SEMANTIC_MIN_SCORE` (0.35) are dropped; real
  matches score about 0.4 to 0.5. Meaning matches pass the same index
  filters (Trash, Archive, favorites, type, site) and qualifier checks as
  keyword matches. Fusion picks the candidate set (401 grid, 400 API); the
  chosen sort orders it.
- **Fallback.** No Files Worker, a worker error or timeout, or more than 60
  uncached searches a minute per user (`semanticSearch` rate limit) leaves the
  search keyword-only, logged as `[search/semantic]`.

## Similar cards and mood

`like:<card id>` (the card panel's **More like this**, the API's `similarTo`)
and `mood:"…"` list meaning matches only (`card/similarSearch.ts`), with no
keyword side:

- `like:` asks the Files Worker's `vector-similar` op, which searches with the
  card's stored vector. The card is checked (the user's, outside Trash) on every
  read and request, so a cached ranking never outlives it. A card with no
  vector yet is cached as `pending` for 15 seconds. Every neighbor counts,
  however close; the card itself is left out.
- `mood:` embeds its text through `vector-query` with `type: "image"`, reads
  images only and keeps matches above `SEMANTIC_MIN_SCORE`.
- One anchor per search: a second `like:` or `mood:` is plain text, and a
  smart folder and a typed search with different anchors match nothing.
- The other qualifiers, the view and the search's words (all must appear)
  narrow the list, then the sort orders it, at most 100 cards.
- Rankings share `semanticSearchResults`, keyed by `like\n<id>` or
  `mood\n<text>`.
- A `mood:` asks Vectorize for the 100 closest image vectors (a metadata
  filter on `type`), so notes and links can't crowd a few images out. An
  unfiltered query runs beside it and adds the closest vectors with no type,
  written before vectors carried one; once the backfill has written every
  vector again it adds nothing. If the index rejects the filter (no `type`
  metadata index), the worker logs `vector type filter failed` and the
  search runs as it did before types. Both return ids and scores only: full
  metadata would cap `topK` at 50.

## Checking search by meaning

`embedding/inspect:searchByMeaning` queries one user's vectors from the Convex
dashboard or CLI. It returns card ids, scores and a short preview of each
match the user owns:

```bash
npx convex run embedding/inspect:searchByMeaning \
  '{"userId":"teak_…","text":"furniture wood that survives rain"}'
```
