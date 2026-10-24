# API, CLI and MCP

People and agents use Teak without the web app through the public REST API, the `teak` CLI and the MCP server, all authenticated with an API key. A card created through any of them shows up in the others and in the web app.

## Sub-features

- `api-auth` rejects a missing or revoked key with 401, and `GET /v1/me` answers with a valid one.
- `api-cards` creates, gets, lists, searches, trashes, restores and permanently deletes cards (`/v1/cards`), and runs bulk operations (`/v1/cards/bulk`) that clean tags the same way a single create does. Bulk items follow the single-card rules: a blank `url`, blank `content` on a card that isn't text, a file `cardType` without an upload (even with a `url`), and any edit to a card in Trash (other than `restore` and `delete`) fail that item. A bulk `create` or `update` item with a field it doesn't take, or an `update` item with nothing to change, fails with `INVALID_INPUT`; bulk `create` trims `notes` and drops a blank one. `PATCH` `removeAiTags` matches ignoring case.
- `api-tag-ops` renames, merges and deletes tags (`/v1/tags/rename|merge|delete`, and MCP's tag tools); the tag being changed may be an older one up to 256 characters, while a new name stays at 64.
- `api-duplicate` finds a saved link under any of its addresses (`GET /v1/cards/duplicate`, `teak cards duplicate`, MCP's `teak_v1_check_duplicate_url`, and the extension's badge): `http`/`https`, a leading `www.`, the host's case, a default port, one trailing slash, a fragment and `utm_*`, `fbclid` and `gclid` don't count; other parameters and their order, the path's case, a `#/` or `#!` route and any other port (`http://…:443`) do. Archived cards match, Trash doesn't, and of two cards for one link the newest is returned. A card with no key (the pack's `/l/` cards) matches only its exact address.
- `api-resave` saves a link that's already in Teak without a second card: `POST /v1/cards` with just the link (`url`, or `content` that is only the link, any variant `api-duplicate` matches) answers 200 `status: "created"` with `resaved: true`, `wasArchived: true` for an archived card, and the existing card, whose `savedAt` is now and `createdAt` unchanged; it leaves Archive and tops `sort=newest`. Tags and notes sent with it are ignored, a link with other words makes a new card, a match only in Trash makes a new card, and it works at 200 of 200 cards on the free plan. An `Idempotency-Key` replay returns the first answer. Bulk `create` items say `resaved: true`, and the same link twice in one request makes one card. `teak add <url>` prints "Already in Teak, moved to the top: <id>", `teak cards get` prints "Saved again <date>", and MCP's `teak_v1_create_card` text reads the same. Every card in the API has `savedAt`, and so does `cards.json` in an export.
- `cli-changes` prints `teak cards changes` as card lines, then `deleted <id>` lines, with `nextCursor: …` on stderr while more pages remain.
- `api-tag-limits` trims a card's tags and keeps one of each case variant, and answers 400 `INVALID_INPUT` to more than 100 tags or a tag over 64 characters, on create, update and bulk alike.
- `api-transcripts` returns an audio card's `aiTranscript` from `GET /v1/cards/<id>`; list and search responses leave it out unless they ask for `include=processing`.
- `api-limits` clamps `limit` on `GET /v1/cards` to 1–100, the `maximum` the OpenAPI document declares.
- `cli-cards` runs `auth status`, `cards create`, `cards search`, `cards list` and `cards delete` from this checkout.
- `mcp-tools` handles `initialize`, `tools/list` (38 tools: 36 `teak_v1_*` plus `search` and `fetch`) and `tools/call` for `teak_v1_create_card`, `teak_v1_search_cards` and `teak_v1_delete_card`. A batch of only notifications gets `202` with no body, at the edge and in Convex.

## How to get to it (user POV)

- REST: `https://reminiscent-kangaroo-59.convex.site/v1/...` on the dev deployment, with `Authorization: Bearer <key>`. Production is `https://teakvault.com/api/...`. OpenAPI is at `/openapi.json`.
- CLI: `bun apps/cli/src/index.ts …` from the repository root, with `TEAK_API_KEY` and `TEAK_API_URL` set.
- MCP: `POST https://reminiscent-kangaroo-59.convex.site/mcp`, JSON-RPC, with the same bearer key.
- A key: Settings → Security → API keys ([settings](./settings.md)), or `scripts/api-key.ts` below.

## Driving it with curl, the CLI and scripts/api-key.ts

Preconditions:

- The dev stack is running (`scripts/api-key.ts` signs in with its seeded account).
- Mint a key, and set the environment for the rest of the run:

```bash
bun .agents/skills/verify-teak/scripts/api-key.ts mint
export TEAK_API_KEY="$(jq -r .key .agents/.state/verify/api-key.json)"
export TEAK_API_URL=https://reminiscent-kangaroo-59.convex.site SITE=https://reminiscent-kangaroo-59.convex.site
E=.agents/.state/verify/<run-id> && mkdir -p "$E"
```

Steps:

- **REST create.** `curl -sS -H "Authorization: Bearer $TEAK_API_KEY" -H "Content-Type: application/json" $SITE/v1/cards -d '{"content":"verify-<run-id> api note","cardType":"text"}' | tee $E/api-create.json` returns 200 with `{"status":"created","cardId":…}`.
- **REST search.** `curl -sS -H "Authorization: Bearer $TEAK_API_KEY" "$SITE/v1/cards?q=verify-<run-id>&mode=keyword&include=content"` lists the card with its content. Without `include=content`, items carry no content.
- **REST saved order.** `sort=newest` and `sort=oldest` follow when a card was last saved (`savedAt`), not when it was first saved. Seed `ordering-saved` (see [find](./find.md)), then `curl -sS -H "Authorization: Bearer $TEAK_API_KEY" "$SITE/v1/cards?tag=scenario-ordering-saved&include=content"`: the first item is the link `…/resaved#…`, first saved 400 days ago and saved again yesterday; with `&sort=oldest` it is last. `createdAfter=<ms a week ago>` (the parameter keeps its name) lists it and `…/two-days`. Paging with `limit=1` and `cursor` lists each card once. Save the answers to `$E/api-saved-order.txt`.
- **REST bulk.** `curl -sS -H "Authorization: Bearer $TEAK_API_KEY" -H "Content-Type: application/json" $SITE/v1/cards/bulk -d '{"operation":"create","items":[{"content":"verify-<run-id> bulk note","cardType":"text","tags":["  ux ","ux",""]}]}' | tee $E/api-bulk.json` returns `summary.succeeded` 1 and the new `results[0].cardId`. `GET $SITE/v1/cards/<id>` shows `"tags":["ux"]`, the same as `POST /v1/cards` with that body. An `"operation":"update"` item `{"cardId":…,"tags":["  design ","design",""]}` leaves `"tags":["design"]`. The CLI's `cards bulk create` (JSON items on stdin) and MCP's `teak_v1_bulk_cards` go through the same route.
- **REST tag limits.** With the headers of REST create, `POST $SITE/v1/cards` with `{"content":"verify-<run-id> tags101","cardType":"text","tags":<101 tags>}` (make them with `jq -nc '[range(101)|"t\(.)"]'`) returns 400 `{"code":"INVALID_INPUT","error":"A card can have at most 100 tags"}`, and one tag of 65 characters returns 400 `"Each tag must be at most 64 characters"`. Exactly 100 tags, one of them 64 characters long, return 200. `"tags":["  Design ","design","DESIGN","","  ","ux"]` creates the card with `"tags":["Design","ux"]`; `GET $SITE/v1/cards/<id>` reads the same. `PATCH $SITE/v1/cards/<id>` with 101 tags returns the same 400, and so does a 65-character tag (its message lists the fields it accepts); a bulk `create` item with 101 tags fails alone with `results[0].code` `INVALID_INPUT`. Save each status and body to `$E/api-tag-limits.txt`.
- **REST bulk rules.** With a marked link card `L` and a marked text card `T` moved to Trash: bulk `update` `{"cardId":L,"url":""}` fails with `INVALID_INPUT` and `GET` still shows the url; `{"cardId":L,"content":""}` fails with "Text content cannot be empty for this card type"; bulk `update` and `favorite` on `T` fail with `NOT_FOUND` and `GET /v1/cards?trashed=true` shows `T` unchanged, while bulk `restore` succeeds. Bulk `create` `{"cardType":"image","url":"https://example.com/a.png"}` fails with the same "needs an uploaded file" message as `POST /v1/cards`.
- **REST tag ops.** `POST $SITE/v1/tags/delete` with a 70-character `tag` reaches the backend (404 "Tag not found" when no card has it), and `POST /v1/tags/rename` with a 65-character `to` returns 400.
- **Duplicate check.** Seed the `url-variants` pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"url-variants"}'`, with the id from `.agents/.state/dev-account.json`. Its links live under `https://example.com/url-variants/k/…` (keyed) and `…/l/…` (no key, for the exact-address fallback). With `curl -sS -G -H "Authorization: Bearer $TEAK_API_KEY" $SITE/v1/cards/duplicate --data-urlencode "url=<url>"`:
  - a `cardId` for `http://example.com/url-variants/k/www`, `https://www.example.com/url-variants/k/utm?utm_campaign=z#x` and `https://example.com:443/url-variants/k/slash`;
  - `null` for `https://example.com/url-variants/k/ids?id=3`, `https://example.com/url-variants/k/app#/other`, `http://example.com:443/url-variants/k/scheme` and `https://example.com:80/url-variants/k/slash`;
  - `null` for `http://www.example.com/url-variants/l/slash#frag`, and a `cardId` for its exact address `https://example.com/url-variants/l/slash/`: a card without a key matches only that way. Production has no such card since its backfill ran (October 2026).

  `bun apps/cli/src/index.ts cards duplicate '<url>'` prints the same id with exit 0, or "No card saves this URL" with exit 4. Save each URL and answer to `$E/api-duplicate.txt`, then permanently delete the pack's cards (`GET $SITE/v1/cards?q=url-variants&mode=keyword`, again with `archived=only` and with `trashed=true`, then `DELETE $SITE/v1/cards/<id>` and `DELETE …?permanent=true` for each, since only a card in Trash can be deleted for good).
- **Re-save.** Seed `resave` (`bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"resave"}'`). With the headers of REST create:
  - `POST $SITE/v1/cards` with `{"url":"http://example.com/resave/015?utm_source=x#top","tags":["ignored"]}` (an archived card) answers `resaved: true`, `wasArchived: true`, and the card with `isArchived: false`, `tags` without `ignored`, `createdAt` from 2023 and `savedAt` now. `GET $SITE/v1/cards?limit=1` lists it first.
  - `{"url":"https://example.com/resave/utm-variant"}` re-saves the card saved with `utm_source`; `{"url":"https://example.com/resave/trashed-1"}` and `{"content":"Read again https://example.com/resave/001"}` each make a new card.
  - Send the first request twice with `-H "Idempotency-Key: verify-<run-id>-resave"`: both answers match, and `savedAt` doesn't move on the second.
  - `POST $SITE/v1/cards/bulk` with `{"operation":"create","items":[{"url":"https://example.com/resave/002"},{"url":"https://example.com/verify-<run-id>"},{"url":"https://www.example.com/verify-<run-id>/"}]}` gives items 0 and 2 `resaved: true` and makes one new card.
  - `bun apps/cli/src/index.ts add https://example.com/resave/003` prints "Already in Teak, moved to the top: <id>", and `… cards get <id>` prints "Saved again <date>". MCP `tools/call` `teak_v1_create_card` with `{"url":"https://example.com/resave/004"}` reads "Already in Teak, moved to the top: <id>".
  - On a second, free account, seed `resave-at-limit` (200 of 200): `POST` `{"url":"https://example.com/resave-limit/5"}` re-saves it and brings it out of Archive, while a new link answers 400 `CARD_LIMIT_REACHED`.

  Save each request and answer to `$E/api-resave.txt`, then delete the pack's cards as for the duplicate check (`q=resave`).
- **CLI changes.** `bun apps/cli/src/index.ts cards changes --since <ms> --limit 3` prints three card lines and `nextCursor: …` on stderr; after a permanent delete, `--since` just before it prints `deleted <id>`.
- **REST transcript.** The seeded "Brand refresh voice memo.m4a" is an audio card with a transcript; find its id with `GET $SITE/v1/cards?type=audio`. `GET $SITE/v1/cards/<id>` has `aiTranscript` ("Quick note for the studio brand refresh…"). `GET $SITE/v1/cards?type=audio` items have no `aiTranscript` key, also with `include=content`; with `include=processing` they have it. `GET $SITE/v1/cards?q=crowded&mode=keyword` (a word only its transcript holds) lists exactly that card.
- **REST limit.** `curl -sS $SITE/openapi.json | jq '.paths["/v1/cards"].get.parameters[] | select(.name=="limit")'` shows `"maximum":100,"minimum":1`. On a vault with more than 100 cards, `GET $SITE/v1/cards?limit=1000` answers 200 with 100 items and `pageInfo.hasMore` true; `limit=0` gives 1 item and `limit=abc` the default 50.
- **REST delete.** `DELETE $SITE/v1/cards/<id>` returns 204 with no body and moves the card to Trash: `GET $SITE/v1/cards/<id>` now answers 404, and `GET $SITE/v1/cards?trashed=true` lists it. Then `DELETE $SITE/v1/cards/<id>?permanent=true` returns 204, and the `GET` answers 404.
- **CLI.** `bun apps/cli/src/index.ts --json auth status` prints `{"status":"ok",…}`, exit 0. `… --json cards create "verify-<run-id> cli note"` prints a `cardId`. `… --json cards search "verify-<run-id>" --mode keyword` lists it. `… --json cards delete <id>` prints `"permanent": false`, and `… --json cards delete <id> --permanent --yes` prints `"permanent": true`. Save each command, its output and its exit code to `$E/cli.txt`.
- **MCP.** With `H=(-H "Authorization: Bearer $TEAK_API_KEY" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")`:
  - `curl -sS "${H[@]}" $SITE/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-teak","version":"1"}}}'` returns `result.serverInfo.name` "teak-api".
  - `… -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'` returns 38 tools: 36 named `teak_v1_*`, plus `search` and `fetch`. `teak_v1_search_cards` declares `limit` with `"maximum":100`.
  - `… -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"teak_v1_search_cards","arguments":{"q":"crowded","mode":"keyword"}}}'` returns one item, the audio card, with no `aiTranscript` key. `{"limit":1000}` returns `isError` true with "INVALID_INPUT: Too big: expected number to be <=100".
  - `… -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"teak_v1_create_card","arguments":{"content":"verify-<run-id> mcp note"}}}'` returns `result.structuredContent.cardId`, with no `isError`.
  - `teak_v1_delete_card` with `{"cardId":…,"confirm":true}` returns `{"status":"trashed"}`. Finish with the REST permanent delete.
- **REST bulk fields and AI tags.** Bulk `create` `[{"content":"verify-<run-id> trimmed","notes":"  a note  "},{"content":"verify-<run-id> blank","notes":"   "}]` reads back notes `"a note"` and `null`. Bulk `update` `{"cardId":…,"metadataTitle":"x"}` fails with `"Unknown field \`metadataTitle\`"`, and `{"cardId":…}` with "Each update item must include content, url, notes or tags". `PATCH $SITE/v1/cards/<id>` with an existing AI tag in other case (`{"removeAiTags":["SOURDOUGH"]}`) removes it; one that doesn't exist returns 200 with `updatedAt` unchanged.
- **MCP notifications.** `curl -sS -i "${H[@]}" $SITE/mcp -d '[{"jsonrpc":"2.0","method":"notifications/initialized"}]'` returns `202` with an empty body; a batch of a notification and a `ping` returns `200` with only the ping's reply.
- **Unauthenticated.** `POST $SITE/mcp` and `GET $SITE/v1/me` without a key both return 401.
- **Key state.** `bun .agents/skills/verify-teak/scripts/api-key.ts check` prints the status `GET /v1/me` answers with the saved key: 200 while it works, 401 once revoked.
- **Cross-surface proof.** A card created through the API appears in the web app when you search its marker ([find](./find.md)).
- **Cleanup.** Permanently delete every card the run created, then `bun .agents/skills/verify-teak/scripts/api-key.ts revoke` (it also clears a key someone already revoked in Settings).

## Gotchas

- Without `TEAK_API_URL`, the CLI silently targets production (`https://teakvault.com/api`). Set it to the dev `.convex.site` origin, with no `/v1` or `/api` suffix.
- The dev deployment has no `/api` prefix; that path exists only behind the production edge proxy.
- `?permanent=true` on a card that isn't in Trash returns 409 `NOT_IN_TRASH`. Trash it first.
- Search defaults to hybrid (meaning plus words) and lists related seeded cards too. Pass `mode=keyword` (REST, MCP) or `--mode keyword` (CLI) for exact checks.
- A hex color or quoted text is reclassified after creation; poll for the type to change. `"cardType":"text"` pins it.
- `--permanent` without `--yes` fails with exit 2 outside a terminal. CLI exit codes: 0 ok, 1 API error, 2 usage, 3 auth, 4 not found, 5 rate limited.
- The live backend may be another branch's push. The doctor says which; backend changes need `bun run dev --detach --push`.
- A free account holds a limited number of cards. Past it (for example after seeding `shuffle-partial`), every create answers 400 `CARD_LIMIT_REACHED` before tags are checked, so run the create steps on an account with room.
- MCP tools ignore arguments they don't declare: `teak_v1_search_cards` takes `q`, and `{"query":…}` silently lists everything.
- MCP is stateless JSON-RPC: no session id, and plain JSON responses. It needs `Content-Type: application/json` (415 otherwise) and an `Accept` that includes JSON (406 otherwise).
- Never paste the key into notes, PRs or chat. Write `<redacted>`.
