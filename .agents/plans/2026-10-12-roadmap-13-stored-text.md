## Goal

Keep the text Teak already extracts: store document text (PDF, Word, PowerPoint, text and code files) and video transcripts, make a searchable prefix part of search, and expose the full text through `get_card_content` on the API, MCP and CLI. Phase 13 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 7](2026-10-12-roadmap-07-search-qualifiers.md), with its `backfillUrlHost` finished before this phase's backfill starts (one backfill at a time).

## Success Criteria

- Searching a phrase that appears only inside a PDF, a Word file or a spoken line in a video finds that card.
- `GET /v1/cards/:id/content` returns the card's full stored text (document text, transcript, or note content) with `kind`, `charCount` and `truncated`; MCP `teak_v1_get_card_content` and `teak content <id>` do the same.
- Existing documents get their text through a backfill; existing videos get transcripts when someone uses Refresh details.
- Deleting a card or an account removes the stored text object from R2.

## Context And Current Facts

- Correct paths: the metadata step is `packages/convex/workflows/steps/metadata.ts` (not `steps/metadata.ts`), and document text comes from `extractFileTextForAiForKey(sourceKey, format, card)` in `workflows/fileProcessing.ts:64`.
- The document branch of `metadata.ts` (about line 260) calls `extractFileTextForAiForKey` for PDF (`inspect` mode `pdf`, up to `FILES_RENDER_MAX_SOURCE_BYTES` = 100 MiB), Word and PowerPoint (`zip` mode) and text-like formats (`text` mode, `MAX_SOURCE_INSPECTION_BYTES` = 2 MiB), feeds the text to `generateTextMetadata`, and then discards it.
- The video branch (about line 212) only analyzes the thumbnail with `generateImageMetadataForStoredKey`. Audio uses `processAudioCard` (`workflows/mediaFacts.ts:111`), the Files Worker `process-audio` op, and stores the result in `aiTranscript`.
- Worker limits (`packages/files-protocol/src/index.ts`): `FILES_AUDIO_MAX_BYTES` = 100 MiB source and `FILES_TRANSCRIPT_MAX_BYTES` = 512 KiB transcript. `transcribeAudio` only warns on a non-`audio/` MIME type, so whether a video container decodes is unproven.
- `buildCardSearchText` already includes `aiTranscript`; the search document is one `searchableText` string on `cardSearchDocuments`, subject to Convex document and search-field size limits.
- R2 keys come from `buildR2ObjectKey({ userId, cardId, role })` (`storage/r2.ts`); `cardStorageObjectKeys` lists every key deleted with a card and during account deletion.
- `GET /v1/cards/` is a prefix route in `http.ts`; `/v1/cards/:id/content` only needs a `parseCardRoute` operation and a handler branch.

## Constraints And Non-goals

- `cardTextContents` rows and `documentTextKey` are covered by card hard delete (`card/deleteCard.ts`, `workflows/cardCleanup.ts`), account deletion (`accountDeletion.ts deleteAccountDataHandler` per card) and `cardStorageObjectKeys` (the new R2 key).
- Search sync goes through `patchCardWithSearchSync`; `buildCardSearchText` appends the stored prefix.
- No new workflow step: storing text happens inside the existing metadata step; the video transcript call is added inside the video branch of the same step.
- Backfill documents only (`migration/backfillDocumentText.ts`, dry run then pages). Videos get transcripts only through Refresh details.
- Public API order: `card/content.ts` internal query → `handleCardsByIdV1Request` branch (`content`) → `executePublicApiOperation` (GET prefix already forwarded) → no new route → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → CLI.
- Verify during the build: Convex search-field and document size limits for the prefix, and whether `process-audio` accepts video containers and stays under Whisper's size limit.

## Backend

- `schema.ts`: `cardTextContents { cardId, userId, kind: "document" | "transcript", text (searchable prefix ≤ 32 KiB), sourceKey, charCount, truncated }` with `by_cardId`, `by_userId`; `cards.documentTextKey?`, `cards.hasExtractedText?: v.optional(v.literal(true))`.
- `workflows/steps/metadata.ts` document branch: store the full text in R2 (role `document-text`), upsert `cardTextContents`, patch `documentTextKey` and `hasExtractedText` via `patchCardWithSearchSync`.
- Video branch: call the `process-audio` path for a transcript when the container is supported; save it to `aiTranscript`; fall back to thumbnail-only on failure (never fail the step for a missing transcript).
- `buildCardSearchText`: append the `cardTextContents` prefix when present (read in `syncCardSearchDocumentHandler`).
- `card/content.ts getCardContentForUser({ userId, cardId })`: owner check, read the R2 object for full text, fall back to `content` or `aiTranscript`.
- `migration/backfillDocumentText.ts`: document cards without `hasExtractedText`, paged, rate-bounded worker calls.

## Web

- No new UI in this phase beyond search finding more cards; the reader view (Phase 14) is the first visual consumer. More information may show "Text extracted (12,345 characters)".

## API / MCP / SDK / CLI

- `GET /v1/cards/:id/content` → `{ cardId, kind, text, charCount, truncated }`; 404 for another user's card; 404 `NO_CONTENT` when nothing is stored.
- MCP `teak_v1_get_card_content` (`READ_ONLY`, untrusted content); SDK `cards.content(id)`; CLI `teak content <id>` (prints text, `--json` for the envelope).

## Docs

- `features.mdx` "Smart search": search inside documents and video speech.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`: the content endpoint, tool and command.
- Ship-month changelog: "Search inside documents and videos".

## UI states

- Empty: a card with no stored text shows nothing new.
- Loading: not applicable (background extraction).
- One item / many items: not applicable.
- Very long names: not applicable; long texts are truncated only in the search prefix, never in `content`.
- Error: extraction failure leaves the card as today; More information shows nothing rather than an error.
- Rate-limited: the content endpoint uses the public API limit.
- UI bar: no new surface.

## Scenario seed packs

- `documents-text`: PDFs (text, scanned without text, 300 pages, huge), DOCX, PPTX, Markdown, code; a video with speech, a video with no audio, a long video; documents with RTL and CJK text.

## Break-it checklist

- UI: search a phrase from page 200 of a PDF; search a phrase from a video; Refresh details on a video.
- Backend: huge PDF (prefix only, full text in R2); scanned PDF (no text, no row); video with no audio track (no transcript, step succeeds); transcript over 512 KiB; another user's card on `/content`; hard delete and account deletion remove the R2 object (assert with the R2 mock); backfill dry run counts match; backfill resumes after interruption.

## Tests

- `packages/convex/__tests__/workflows/steps/metadata.test.ts`: document text stored in R2 (mocked) and `cardTextContents`; video branch requests a transcript and tolerates failure.
- `packages/convex/__tests__/card/searchDocuments.test.ts` (or `occContention.test.ts` fixtures): a phrase only in the PDF prefix is searchable after sync.
- `packages/convex/__tests__/card/content.test.ts`: owner-only, fallbacks, `truncated`.
- `packages/convex/__tests__/storage/r2.test.ts`: `cardStorageObjectKeys` includes `documentTextKey`.
- `packages/convex/__tests__/migration/backfillDocumentText.test.ts`: dry run writes nothing; pages resume.
- `packages/convex/__tests__/publicApiHttpCards.test.ts` and `mcp.test.ts`: content route and tool.

## Proof before the PR

- Video: upload a PDF, search a sentence from its middle, open the card; Refresh details on a video and search a spoken phrase.
- Screenshots: search results for the PDF phrase; More information with the text line; light and dark; 390px and 1440px.
- Captured `GET /v1/cards/:id/content`, MCP output, `teak content <id>`, and the backfill dry-run report.

## Release gate

1. Narrow tests above, then the repo checks and `03-api.e2e.ts`, `04-cli.e2e.ts`, `05-mcp.e2e.ts`.
2. Seed `documents-text`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge. If the video transcript needs a Files Worker change, deploy the worker first and add the op to `scripts/check-files-readiness.ts`. Deploy Convex then web; confirm `backfillUrlHost` is done; run `backfillDocumentText` dry run, then pages at a bounded rate; smoke-test a PDF phrase search and the content endpoint in production.

## Risks And Open Questions

- Backfill cost: one worker `inspect` per existing document. Page slowly and watch Files Worker and Convex usage.
- If video containers do not decode through `process-audio`, the worker needs an audio-extraction step (larger change); confirm before committing to the video half.
