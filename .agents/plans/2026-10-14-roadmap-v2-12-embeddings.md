## Goal

Give every card one semantic vector in Cloudflare Vectorize, embedded with `@cf/baai/bge-m3` (1024 dimensions, cosine). Keep it fresh when the card's searchable text changes, and remove it when the card or account is deleted. Backfill every existing card. No user-facing search change yet. Phase 12 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 10](2026-10-14-roadmap-v2-10-ocr-images.md): `aiOcrText` goes into the embedded text.
- [v1 phase 13](2026-10-12-roadmap-13-stored-text.md): the `cardTextContents.text` prefix.

## Success Criteria

- Every non-trashed card with any text has exactly one vector (id = card id) once processing and the backfill are done. Cards with no text yet (an image still waiting for AI) get one as soon as they have text.
- Editing notes, tags or the title re-embeds the card once, about 30 s after the last edit. An edit that leaves the embedded text unchanged makes no Workers AI call.
- Card hard delete (`permanentDeleteCard`, `cleanupDeletedCard`) and account deletion leave no vectors behind. A weekly report-only sweep shows zero orphans.
- If the worker is down or returns 429, cards still save and process. The embedding retries later and never fails `cardProcessingWorkflow`.
- `vector-query` returns the caller's own cards only, with a `type` filter. Phase 13 is its first consumer.

## Context And Current Facts

- There is no Vectorize binding today. The prod worker config is `apps/files-worker/wrangler.jsonc` (`teak-files-proxy`). The dev worker has its own config, `apps/files-worker/development/wrangler.jsonc` (`teak-files-development`), whose shape is asserted by `src/deployment.test.ts`. Both already have the `AI` binding (`"remote": true`).
- Worker ops are listed in `FILES_OPS` (`packages/files-protocol/src/index.ts`) and dispatched in `apps/files-worker/src/ops.ts`. The `capabilities` op reports `ai`, `images`, `browser` and the renderer. `scripts/check-files-readiness.ts` requires those plus a `required` op list.
- Convex calls the worker with `callFilesWorkerJson` (`storage/filesWorkerClient.ts`). The file has no `"use node"`, so it also runs in httpActions (which phase 13 relies on). Worker 5xx responses and `AI_CAPACITY` throw, so callers retry.
- `cardProcessingWorkflow` (`workflows/cardProcessing.ts`):
  - It ends after metadata and renderables, then emits completion telemetry.
  - Its `returns` validator is a strict `v.object`, so a new step must not add result keys (or must add them as optional).
  - The link screenshot runs in a separate workflow (`workflows/screenshot.ts`) and can add `aiOcrText` after phase 11.
- Content edits rerun the whole pipeline (`updateCard` → `reserveEditReprocess` → `startCardProcessingWorkflow`). Notes, tags and title edits do not, but they all pass through `patchCardWithSearchSync`, and so through `syncCardSearchDocumentHandler`, which compares the old and new `searchableText`.
- Hard delete:
  - `permanentDeleteCard` and `permanentDeleteCardForUser` share a handler in `card/deleteCard.ts`.
  - The 30-day Trash purge is `cleanupDeletedCard` (`workflows/cardCleanup.ts`).
  - Both call `deleteObject` for `cardStorageObjectKeys(card)`, which schedules the durable `workflows/objectCleanup` deletion with retries.
- Account deletion has two card paths:
  - the legacy loop in `runAccountDataDeletion` (`accountDeletion.ts`: `getAccountCardDeletionBatch` → `deleteKeys` → `deleteAccountDataBatch`)
  - the staged path (`accountDeletionBatch.ts captureDeletionBatch("cards")` → `accountDeletionData.drainStorageBatch` → `checkpointStorageBatch`)
  - Per-user side tables are removed in `accountDeletionData.ancillaryPage`.
- Orphans are reported weekly by `workflows/orphanSweep.ts` (report only, never deletes).
- Vectorize limits (Cloudflare docs, checked 2026-10-14):
  - 50,000 namespaces per index on Workers Paid
  - `topK` up to 100 without values or metadata, 50 with them
  - upsert batches of 1,000 from Workers
  - 10 metadata indexes, each indexing the first 64 bytes of a string
  - Metadata indexes must exist **before** vectors are inserted.
  - Writes become queryable asynchronously (seconds).
  - `queryById` exists (phase 14 uses it).
- Teak user ids look like `teak_<id>`, well under 64 bytes.

## Constraints And Non-goals

- Index names:
  - Prod: `teak-cards`, 1024 dimensions, cosine.
  - Dev: `teak-cards-development`.
  - Metadata indexes on `userId` (string) and `type` (string), created before the first upsert.
  - Every query filters `userId` `$eq`. **No namespaces**, because of the 50,000 limit.
- Embedded text, in this order, joined with newlines:
  1. `metadataTitle`
  2. `aiSummary`
  3. user tags, then AI tags
  4. `notes`
  5. `visualStyles` (images)
  6. `aiOcrText`
  7. the first 2,000 characters of `content`, the `cardTextContents` prefix or `aiTranscript`, in that order of preference
  - The whole text is capped at 8,000 characters. `EMBED_TEXT_VERSION = 1` is part of the hash, so a change in the recipe re-embeds.
- Embedding state lives in a new table, `cardEmbeddings`, not on `cards`. Writing `cards.embeddedAt` would re-run every reactive grid query that contains the card and add OCC load. This is a deliberate change from the approved plan's `cards.embeddedAt` / `embeddingHash`.
- Hidden, trashed and archived cards keep their vectors. Convex filters them at query time (phase 13). Only hard delete removes a vector.
- No user-visible UI, no API, MCP or CLI change, and no changelog entry, per `apps/docs/AGENTS.md`: this is internal until phase 13.

## Files Worker

- Both `wrangler.jsonc` files get `"vectorize": [{ "binding": "VECTORIZE", "index_name": "teak-cards" }]` (`teak-cards-development` for dev). Update `deployment.test.ts`.
- `src/vectors.ts` (new):
  - `EMBEDDING_MODEL_ID = "@cf/baai/bge-m3"`.
  - Embed in batches of up to 32 texts per `AI.run`, with the capacity retries copied from `imageMetadata.ts`.
  - Check that each vector has 1024 dimensions.
- New ops, also added to `FILES_OPS` and `ops.ts`:
  - `embed-upsert { items: [{ id, userId, type, text }] ≤ 32 }`: embeds the texts, then upserts each vector with id = card id and metadata `{ userId, type }`. Returns `{ upserted, mutationId }`.
  - `vector-query { userId, text?, vectorOfId?, topK ≤ 100, types?: CardType[], excludeIds? }` returns `{ matches: [{ id, score }] }`.
    - It embeds `text`, or uses `queryById` for `vectorOfId` (phase 14).
    - It filters `userId` (and `type` with `$in`) and returns no metadata, so `topK` can reach 100.
    - It refuses a `vectorOfId` vector whose `userId` metadata is someone else's.
  - `vector-delete { ids ≤ 1000 }`: `deleteByIds`.
  - `vector-list { cursor? }`: a page of ids for the orphan sweep.
- `capabilities` adds `vectorize: Boolean(env.VECTORIZE)`.

## Backend

- `schema.ts`: `cardEmbeddings { cardId, userId, hash, embeddedAt?, dueAt?, attempts?, lastError? }` with `by_cardId`, `by_userId` and `by_dueAt`.
- `embedding/text.ts`: pure `buildEmbeddingText(card, storedTextPrefix)` and `embeddingHash()` (SHA-256 through WebCrypto).
- `embedding/schedule.ts` `markCardForEmbedding(ctx, cardId, userId)`:
  - Called by `syncCardSearchDocumentHandler` when `searchableText` changed, and on insert.
  - Upserts the card's own row with `dueAt = now + 30 s`, and schedules `embedding/embedCard:embedDue` only when no row was already due. One read and one write of a per-card row, so it adds no shared hot spot.
  - It stands down during account deletion, like the search sync.
- `embedding/embedCard.ts` (`internalAction`):
  - Batches due rows (≤ 32) and builds each text and hash.
  - Skips cards whose hash is unchanged or whose text is empty. A trashed card is still embedded.
  - Calls `embed-upsert`, then `recordEmbedded` with the hash it embedded.
  - If `recordEmbedded` finds the card hard-deleted in the meantime, it schedules `vector-delete`.
  - Retries back off on `attempts`. After 5 attempts the row keeps `lastError` and is picked up by the next backfill run.
- `cardProcessing.ts`: append a final `embed` step after the metadata and renderables results and before the completion telemetry. It calls the same action, swallows failures (logging them), and adds nothing to the workflow's return value.
- Delete cascade:
  - `card/deleteCard.ts` and `cleanupDeletedCard` delete the `cardEmbeddings` row and schedule `embedding/vectorCleanup.startVectorDeletion({ ids })`, a durable workflow modelled on `objectCleanup` with `OBJECT_DELETION_STEP_RETRY`.
  - In account deletion, `getAccountCardDeletionBatch` and `captureDeletionBatch("cards")` also return `vectorIds` (card ids that have a `cardEmbeddings` row).
  - `deleteKeys` and `drainStorageBatch` call `vector-delete` before the rows are committed. `ancillaryPage` removes the leftover `cardEmbeddings` rows by `by_userId`.
- `orphanSweep.ts`: page through `vector-list` and report vector ids with no card. Report only.
- `migration/backfillEmbeddings.ts`:
  - Pages `cards` (100 at a time) and counts the cards with text and no up-to-date `cardEmbeddings` hash, plus any `userId` over 64 bytes.
  - A real run calls `markCardForEmbedding` with spaced `dueAt`, at about 300 cards a minute.
  - Dry run by default; resumable with `once`.
- `shared/analytics.ts`: add the server event `card_embedding_failed { error_class }`.

## Docs

- `(legal)/privacy-policy.mdx`: the Cloudflare row covers "search index of card text (embeddings)". The owner reviews the wording.
- No `features.mdx` or changelog entry, because nothing changes for users yet.

## UI states

- Not applicable: there is no new surface. Every state stays as it is today.

## Scenario seed packs

- `embeddings-volume`: 1,000 cards of all 8 types through the real pipeline on dev. Included:
  - 50 cards that are only an image with no AI yet (no vector until processing)
  - text that is only emoji, RTL or CJK
  - 8,000-character notes
- Scripted churn: one card edited 20 times in a minute, a burst of tag renames across 300 cards (`tagOperations`), and a delete-and-restore loop.
- Failure modes: a dev worker build where the `VECTORIZE` binding is missing, and a mocked 429 from `AI_CAPACITY`.

## Break-it checklist

- Backend:
  - 20 edits in a minute produce one embed.
  - An edit that does not change the text makes no AI call.
  - A rename across 300 cards spreads its re-embeds out.
  - Hard delete while an embed is in flight leaves no orphan.
  - Purge after 30 days in Trash.
  - Account deletion through both paths, then `vector-list` for that user returns nothing.
  - A `vector-query` with another user's id returns nothing, and `vectorOfId` on another user's card is refused.
  - The worker is down: processing completes and the embed retries.
  - OCC under `occContention.test.ts` fixtures.
  - The backfill dry run counts, a resume, and it skips accounts being deleted.
- UI: saving, editing and deleting cards still feel instant (no regression), at 390px and 1440px.

## Tests

- `apps/files-worker/src/vectors.test.ts` (new): batching, dimension check, capacity retries, `userId` filter, and the `vectorOfId` ownership refusal, using a mocked `VECTORIZE` and `AI`.
- `apps/files-worker/src/ops.test.ts`, `index.test.ts` and `deployment.test.ts`: the new ops, `capabilities.vectorize`, and both bindings.
- `packages/files-protocol/src/index.test.ts`: the ops are listed.
- `packages/convex/__tests__/embedding/text.test.ts`: field order, cap, version-in-hash, CJK and emoji.
- `packages/convex/embeddings.test.ts` (new convex-test file, added to `vitest.config.ts`):
  - the debounce row, and that an unchanged hash skips the call (worker mocked)
  - hard delete, Trash purge and both account deletion paths schedule `vector-delete` and remove the rows
  - a delete during an embed
- `packages/convex/__tests__/workflows/cardProcessing.test.ts`: the embed step runs last and a failure in it does not fail the workflow.
- `packages/convex/__tests__/migration/backfillEmbeddings.test.ts`: the dry run writes nothing; pages resume.
- `packages/convex/__tests__/workflows/orphanSweep.test.ts`, or the existing sweep tests: vector orphans are reported.

## Proof before the PR

- There is no UI, so the proof is captured output:
  - `wrangler vectorize info teak-cards-development` before and after seeding
  - a dev `vector-query` for a seeded user returning their card ids with scores
  - the same query for another user returning nothing
  - the 20-edit churn log showing one embed
  - `vector-list` empty after an account deletion
  - the backfill dry-run report
- A short video of saving, editing and deleting cards on dev at 1440px, to show there is no slowdown.

## Release gate

1. The narrow tests above, then the repo checks and `07-account-lifecycle.e2e.ts` and `13-occ-concurrency.e2e.ts`. Break the hash guard and the delete cascade on purpose and confirm the tests fail.
2. Seed `embeddings-volume` on dev, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. PR, green CI, merge. Then:
   1. From `apps/files-worker`, create both indexes and their metadata indexes **before** deploying:
      - `bunx wrangler vectorize create teak-cards-development --dimensions=1024 --metric=cosine`
      - `bunx wrangler vectorize create-metadata-index teak-cards-development --property-name=userId --type=string`
      - the same with `--property-name=type`
      - repeat all three for `teak-cards`
      - Confirm with `bunx wrangler vectorize list-metadata-index teak-cards`.
   2. Deploy the Files Worker (`deploy:development`, then `deploy`). Add the four ops and `vectorize` to `check-files-readiness.ts` and run it with `--prod`.
   3. Deploy Convex, then web.
   4. Run `migration/backfillEmbeddings:backfillEmbeddings` as a dry run. Check the counts and that no `userId` is over 64 bytes. Then run it in pages.
   5. Watch Workers AI neurons and Vectorize stored and queried dimensions daily until it is done.
   6. Smoke test: save a card in production and confirm its vector exists with `wrangler vectorize get-vectors teak-cards --ids <cardId>`.

## Risks And Open Questions

- **Contradiction.** The approved plan's design uses `namespace = userId`. Vectorize allows only 50,000 namespaces per index on Workers Paid, so this plan filters on a `userId` metadata index instead.
- **Contradiction.** The master plan says `cards.embeddedAt` / `embeddingHash`. This plan keeps that state in `cardEmbeddings` so embedding never touches card documents.
- **Contradiction (minor).** The master plan calls document text "cut to 6,000 characters and thrown away". The extraction keeps up to 512 KiB and 50 pages; only the AI prompt is cut at `MAX_AI_METADATA_INPUT_CHARS = 6000`.
- **Input length.** Confirm Workers AI's input token limit for `bge-m3` during the build. If it is below the 8,000-character text, lower the cap.
- **Delay.** Vectorize writes are queryable seconds later. Phase 14's `like:` on a just-saved card needs a "still indexing" state.
- **Backfill cost.** About 1 embedding per card. Measure the neurons used on dev for 1,000 cards and extrapolate before running the prod backfill.
