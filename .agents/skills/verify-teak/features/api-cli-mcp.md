# API, CLI and MCP

People and agents use Teak without the web app through the public REST API, the `teak` CLI and the MCP server, all authenticated with an API key. A card created through any of them shows up in the others and in the web app.

## Sub-features

- `api-auth` rejects a missing or revoked key with 401, and `GET /v1/me` answers with a valid one.
- `api-cards` creates, gets, lists, searches, trashes, restores and permanently deletes cards (`/v1/cards`), and runs bulk operations (`/v1/cards/bulk`) that clean tags the same way a single create does.
- `cli-cards` runs `auth status`, `cards create`, `cards search`, `cards list` and `cards delete` from this checkout.
- `mcp-tools` handles `initialize`, `tools/list` (36 tools) and `tools/call` for `teak_v1_create_card`, `teak_v1_search_cards` and `teak_v1_delete_card`.

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
- **REST bulk.** `curl -sS -H "Authorization: Bearer $TEAK_API_KEY" -H "Content-Type: application/json" $SITE/v1/cards/bulk -d '{"operation":"create","items":[{"content":"verify-<run-id> bulk note","cardType":"text","tags":["  ux ","ux",""]}]}' | tee $E/api-bulk.json` returns `summary.succeeded` 1 and the new `results[0].cardId`. `GET $SITE/v1/cards/<id>` shows `"tags":["ux"]`, the same as `POST /v1/cards` with that body. An `"operation":"update"` item `{"cardId":…,"tags":["  design ","design",""]}` leaves `"tags":["design"]`. The CLI's `cards bulk create` (JSON items on stdin) and MCP's `teak_v1_bulk_cards` go through the same route.
- **REST delete.** `DELETE $SITE/v1/cards/<id>` returns 204 with no body and moves the card to Trash (a `GET` still answers 200). Then `DELETE $SITE/v1/cards/<id>?permanent=true` returns 204, and the `GET` answers 404.
- **CLI.** `bun apps/cli/src/index.ts --json auth status` prints `{"status":"ok",…}`, exit 0. `… --json cards create "verify-<run-id> cli note"` prints a `cardId`. `… --json cards search "verify-<run-id>" --mode keyword` lists it. `… --json cards delete <id>` prints `"permanent": false`, and `… --json cards delete <id> --permanent --yes` prints `"permanent": true`. Save each command, its output and its exit code to `$E/cli.txt`.
- **MCP.** With `H=(-H "Authorization: Bearer $TEAK_API_KEY" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")`:
  - `curl -sS "${H[@]}" $SITE/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-teak","version":"1"}}}'` returns `result.serverInfo.name` "teak-api".
  - `… -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'` returns 36 tools.
  - `… -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"teak_v1_create_card","arguments":{"content":"verify-<run-id> mcp note"}}}'` returns `result.structuredContent.cardId`, with no `isError`.
  - `teak_v1_delete_card` with `{"cardId":…,"confirm":true}` returns `{"status":"trashed"}`. Finish with the REST permanent delete.
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
- MCP is stateless JSON-RPC: no session id, and plain JSON responses. It needs `Content-Type: application/json` (415 otherwise) and an `Accept` that includes JSON (406 otherwise).
- Never paste the key into notes, PRs or chat. Write `<redacted>`.
