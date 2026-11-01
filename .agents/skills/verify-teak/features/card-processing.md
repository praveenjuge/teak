# Card processing

After a card is saved, Teak works on it in the background: it settles the card's type, adds AI tags and a summary, and for links, files and media fetches previews, thumbnails, palettes and transcripts. Each stage shows in the card's processing status and finishes as completed or failed. A card edited while it's being processed is processed again, and the older run gives way without overwriting the newer one.

## Sub-features

- `processing-stages` takes a new card's `processingStatus` stages (classify, categorize, metadata, renderables) from pending to completed, with the AI tags and summary readable on the card.
- `ai-language` writes the AI tags and summary in the content's main language (English when it has none, or for an image with no text) and stores that language as `cards.aiLanguage` (`ja`, `es`…). It isn't in the public API or the UI; read it from the run's output or the card document.
- `ai-unreachable-link` gives a link whose page couldn't be read (its preview failed, or came back empty) no AI summary and no AI tags, unless a site summary, an article or a transcript gave real text: the metadata stage completes with nothing, instead of a description invented from the URL. A link not yet previewed is still described from its URL.
- `processing-run` is the Workflow run behind it: one instance per card revision, named `card-<cardId>-<rev>`, with its steps, attempts, output and errors.
- `processing-files` covers what a run stores in the Files bucket (thumbnails, previews, screenshots) under the account's key prefix. A link's preview image that its host refused with 429 or a 5xx is tried again in the run's last step, "store link preview image", for about 7½ minutes, and lands as `linkPreview.imageStorageKey`; a 404 or a non-image is not retried.
- `processing-logs` covers the Core Worker's logs and traces for a run: warnings, errors and each invocation's outcome.
- `processing-crons` covers the Core Worker's scheduled jobs (maintenance, AI usage rollup, export cleanup), started on demand.

## How to get to it (user POV)

- Save a card anywhere (the composer, the API, the CLI, MCP, the extension). Its tags and summary appear on the card in the library, and in the card dialog, within seconds.
- The run itself is not shown to users. On the local E2E stack, the Core Worker serves Cloudflare's Local Explorer at `http://127.0.0.1:4102/cdn-cgi/local/explorer` (a browser UI) and its REST API at `/cdn-cgi/local/explorer/api` (the OpenAPI document is the API root).

## Driving it with the API and Local Explorer

Preconditions:

- The local E2E stack, which runs the Core Worker under `wrangler dev --local`: `bun run dev --stop`, then `bun run --cwd packages/tests e2e:stack` as a background command (it prints "E2E stack is up"). Ports are in `.agents/.state/stack.json` (`ports.coreWorker`, `urls.apiOrigin`); a worktree has its own. The shared dev deployment's Worker runs on Cloudflare, so these steps don't reach it.
- An emulator account with an API key: call `createApiAccount("verify")` from `packages/tests/src/helpers/app.ts` in a short `bun --no-env-file` script, and keep the key in `.agents/.state/verify/<run-id>/`.

Steps (with `X=http://127.0.0.1:4102/cdn-cgi/local/explorer/api` and `API=http://127.0.0.1:3211`):

- **Save.** `curl -X POST $API/v1/cards -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"content":"verify-<run-id> sourdough starter notes"}'`. The response has `cardId`, and `processingStatus.classify` and `.metadata` are `pending`.
- **Run.** `curl $X/workflows/teak-e2e-card-processing/instances`: an instance `card-<cardId>-1` is `running`, then `complete`. `curl $X/workflows/teak-e2e-card-processing/instances/card-<cardId>-1`: `result.steps` lists "load card", "classify", "generate metadata", "emit completion" and "report complete", each `success: true`, and `result.output` is `{"mode":"completed", …, "metadata":{"aiTagsCount":4,"hasSummary":true, …}}`. The same from Wrangler, run in `apps/core-worker`: `bunx wrangler workflows instances describe teak-e2e-card-processing latest --local --port 4102` (step outputs and timing as tables).
- **Language.** The same run's "generate metadata" step output and `result.output.metadata` carry `"aiLanguage":"en","aiPromptVersion":2`: the E2E stack's fake AI always answers English. The card document has `aiLanguage: "en"` (the Convex dashboard for the local backend, or `bunx convex data cards` against it); the public API doesn't return it.
- **Second view.** `curl $API/v1/cards/<cardId> -H "Authorization: Bearer $KEY"`: `aiTags` and `aiSummary` are filled, and every `processingStatus` stage is `completed`.
- **Unreachable link.** `curl -X POST $API/v1/cards … -d '{"content":"https://example.com/verify-<run-id>-missing"}'` (a path that answers 404). Once its run is `complete`, `GET $API/v1/cards/<cardId>`: `linkPreview` has `status: "error"`, `aiSummary` is absent and `aiTags` is empty, and `processingStatus.metadata` is `completed`. The run's output has `"metadata":{"aiTagsCount":0,"hasSummary":false, …}`. In the web app the card dialog shows no summary, and "Archived copy" says "The page couldn't be reached". `bun test apps/core-worker/src/workflows/cardProcessing/metadata.test.ts` proves it without the stack ("a page that couldn't be reached gets no invented summary or tags").
- **Logs.** `curl -X POST $X/local/observability/query -H 'content-type: application/json' -d '{"sql":"SELECT level, message FROM logs WHERE level IN (?, ?) ORDER BY ts_ms DESC LIMIT 20","params":["error","warn"]}'`. Root spans: `SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL ORDER BY start_ms DESC`.
- **Files.** `curl "$X/r2/buckets/teak-files-e2e/objects"` lists stored objects, keyed `users/<user key>/cards/…` (the seeded vault's uploads are already there); an image or file card adds its own. `curl "$X/r2/buckets/teak-files-e2e/objects/<key>"` returns one.
- **Deleted files.** A file's signed link stops serving it once the object is deleted, even after an earlier download put it in the edge cache. Sign a URL for a key with `buildFileSigningPayload` and the stack's `E2E_FILES_SIGNING_SECRET` (`packages/tests/src/stack/coreWorker.ts`), `GET` it twice (200, same `ETag`), then delete the card through the API, or the object with `bunx wrangler r2 object delete teak-files-e2e/<key> --local --persist-to .agents/.state/e2e-core-worker/state --config .agents/.state/e2e-core-worker/wrangler.json` in `apps/core-worker`. The same link now answers 404; an object replaced under its key answers with the new `ETag` and bytes.
- **Crons.** `curl "$X/local/workers"` lists the Workers with their bindings and crons. `curl -X POST "$X/local/scheduled?worker=teak-files-e2e" -H 'content-type: application/json' -d '{"cron":"45 * * * *"}'` runs that scheduled job now and answers `"outcome":"ok"`.
- **Regression proof.** `bun test apps/core-worker/src/workflows/cardProcessing/engine.test.ts` runs card processing on the same Workflows engine against a fake Convex: retries, a stale write ending the run as skipped, and errored runs reported back.

## Gotchas

- Whether the model really writes in the content's language needs the real Workers AI, so prove `ai-language` on the dev deployment once its Core Worker runs this code: `bun --no-env-file run scripts/seed/ai-language-check.ts --seed --wait 15` seeds the `ai-languages` pack on this checkout's dev account and prints each card's expected language, `aiLanguage` and summary script, then the accuracy per language (ja, es, de, ko, zh and fr must reach 90%). Images, PDFs and audio aren't seeded: upload a photo of Japanese signage, a photo with no text, a German PDF and a Spanish voice note through the app and read their card dialogs.

- Links saved before this fix keep the summaries the model wrote from their URL; "Refresh details" on such a card, with the page still unreachable, empties its AI tags but keeps the old summary (a summary from a time the page could be read is worth keeping). Prove the fix on a newly saved or imported link.
- A text or quote card with no text skips the AI: its metadata stage completes with no tags and no summary, rather than a made-up description of an empty note. Prove it with `bun test apps/core-worker/src/workflows/cardProcessing/metadata.test.ts`, or on the E2E stack by saving a note, emptying its `content` through the API, and reading the card once its run is `complete`.
- The E2E stack's AI is a deterministic fake (`apps/core-worker/e2e/fakeAi.ts`): tags are the first words of the content and the summary starts "Saved note about". It doesn't answer the card-type decision, so a text card logs `malformed_clef_response` (op `decide-card-type`) and keeps the rules' type. That is expected here, not a bug.
- Browser Run, Vectorize and the two Containers aren't on the E2E stack, so link fetching, screenshots, media rendering and embeddings fail there the way they do when those services are down. Prove those on the dev deployment through the app.
- "Refresh details" on a link fetches its page again instead of reusing the copy kept for a day in `LINK_PAGE_CACHE`, so a page that changed since it was saved gets a new preview. Link fetching isn't on the E2E stack; prove it on the dev deployment by refreshing a link whose page changed, or with `bun test apps/core-worker/src/workflows/cardProcessing/linkMetadata.test.ts`.
- An edit bumps the card's revision: the next run is `card-<cardId>-2`, and the older one is stopped (`terminated`). If the older run reaches Convex before the stop does, it ends `complete` with output `{"mode":"skipped","reason":"superseded"}` instead. An `errored` instance is a real failure; its `result.error` and the logs say why.
- Explorer state lives in `.agents/.state/e2e-core-worker/state` and is wiped when the E2E stack restarts. Cleanup is stopping the stack (Ctrl-C on `e2e:stack`, or ending its background command); the emulator account goes with it.
- Never call the `DELETE` or `PATCH …/status` endpoints on a run you are using as evidence; they change what you are trying to prove.
