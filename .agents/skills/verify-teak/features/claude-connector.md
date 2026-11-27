# Teak in Claude

Claude connects to Teak's MCP server through the connector directory or a custom connector; Claude Code can also install Teak's plugin (a Teak skill plus `/teak:save`, `/teak:search`, `/teak:recent`). MCP Apps clients render the cards as Teak cards, not JSON.

## Sub-features

- `mcp-app-resource` lists one resource, `ui://teak/cards.html` (`text/html;profile=mcp-app`), in `resources/list`, answered at the edge and in Convex alike. `resources/read` returns the view's HTML with `_meta.ui`: `csp.resourceDomains` holding only the deployment's files origin (`https://files.teakvault.com` in production, the dev Core Worker on dev), `connectDomains` empty, `prefersBorder: true`, and `domain` (Claude's sandbox origin) the first 32 hex characters of the MCP URL's SHA-256, then `.claudemcpcontent.com`. Any other `uri` answers `-32002`.
- `mcp-app-tools` marks exactly `teak_v1_search_cards`, `teak_v1_list_cards`, `teak_v1_list_favorite_cards`, `teak_v1_get_card` and `teak_v1_create_card` with `_meta.ui.resourceUri` (and the legacy `ui/resourceUri`).
- `mcp-app-views` shows a search as "Results for “<q>”" with a count, favorites as "Favorites", a list as "Recent cards", one card with its image, summary, notes, tags, "Open in Teak" and "Visit source", and a save as "Saved to Teak" (or "Already in Teak, moved to the top"). Notes and quotes show plain text, no repeated title; palettes show their colors; an untitled card shows only its type or site. Clicking a card or "Open in Teak" asks the host to open the card's `appUrl` (`ui/open-link`).
- `mcp-app-host` follows the host's theme (light, dark) and language (any of the eight; `pt-PT` → Portuguese (Brazil), `zh-CN` → Simplified Chinese, others → English), and reports its height.
- `claude-plugin` validates and installs from this repository (`teak@teak`) with the skill and three commands, and its `/teak:search` summarizes real cards from `teak_v1_search_cards`.
- `demo-seed` (`scripts/seed/seed-demo-account.ts`) fills an account with about 45 cards, six images, three folders, a smart folder and favorites; a second run saves nothing.

## How to get to it (user POV)

- Claude: Settings → Connectors → Teak (or Add custom connector with the MCP URL), then ask it to find, open or save cards. A cloud session can't drive Claude; use `scripts/mcp-app-host.ts`.
- Claude Code: `/plugin marketplace add praveenjuge/teak`, `/plugin install teak@teak`, then `/teak:search <words>`.
- MCP: `POST https://reminiscent-kangaroo-59.convex.site/mcp` with an API key, as in [api-cli-mcp](./api-cli-mcp.md).

## Driving it with curl, scripts/mcp-app-host.ts and the claude CLI

Mint a key (`bun .agents/skills/verify-teak/scripts/api-key.ts mint`), with `SITE` and `H` as in [api-cli-mcp](./api-cli-mcp.md). Evidence goes to `.agents/.state/verify/<run-id>/`.

- **Resource.** `curl -sS "${H[@]}" $SITE/mcp -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}'` lists `ui://teak/cards.html`. `… -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"ui://teak/cards.html"}}' > $E/resources-read.json`: check `.result.contents[0]._meta.ui` against `mcp-app-resource`; compute the expected domain with `node -e 'console.log(require("crypto").createHash("sha256").update("https://reminiscent-kangaroo-59.convex.site/mcp").digest("hex").slice(0,32))'`. The `text` equals `TEAK_APP_HTML` in `packages/convex/mcp/appHtml.generated.ts` once dev runs this checkout (doctor: "this checkout is pushing").
- **Tools.** `… -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}' | jq '[.result.tools[] | select(._meta) | .name]'` lists the five tools in `mcp-app-tools`.
- **Views.** `bun .agents/skills/verify-teak/scripts/mcp-app-host.ts $E verify-<run-id>` calls search ("design"), favorites, recent, get (the first link found) and create (`https://example.com/<marker>`), and renders each in light, dark and Japanese under the resource's CSP. It saves `mcp-app-<view>-<theme>-<locale>.png` and `mcp-app-report.json` (images loaded, CSP or script problems, each click's requested URL), and exits 1 on any problem or broken image. Check the screenshots against `mcp-app-views`; `ja-JP` shots are all Japanese.
- **Plugin.** Keep your own config untouched: `CFG=$(mktemp -d)`, then `claude plugin validate ./plugins/teak && claude plugin validate .`, `CLAUDE_CONFIG_DIR=$CFG claude plugin marketplace add ./`, `CLAUDE_CONFIG_DIR=$CFG claude plugin install teak@teak`, `CLAUDE_CONFIG_DIR=$CFG claude plugin list` (teak 1.0.x, enabled). For dev, write an MCP config (scratch folder, mode 600) with a server `teak` at `$SITE/mcp` and an `Authorization: Bearer <key>` header, then `CLAUDE_CONFIG_DIR=$CFG claude -p "/teak:search design" --strict-mcp-config --mcp-config <file> --allowedTools mcp__teak__teak_v1_search_cards --output-format stream-json --verbose --max-turns 6`: the stream shows a `teak_v1_search_cards` call with `q: "design"` and real card titles. Delete the config file afterwards.
- **Seed.** `bun --no-env-file run scripts/seed/seed-demo-account.ts --api $SITE --dry-run` lists what it would save. For a real run, snapshot `GET $SITE/v1/cards?limit=100` ids and `GET $SITE/v1/folders`, run it twice (the second prints "Saved 0 cards"), then permanently delete every card not in the snapshot and the folders Design inspiration, Reading list, Redesign and Palettes.

## Gotchas

- After changing `packages/mcp-app`, run `bun run build` there to regenerate `packages/convex/mcp/appHtml.generated.ts` (its test fails if stale) and let the dev stack push before reading the resource.
- On dev, `appUrl` points at the main checkout's web app (`TEAK_DEV_APP_URL`, port 3000 unless set).
- Link screenshots before 31 Oct 2026 can be unstyled: old data, not the view.
- The plugin's own server (`https://teakvault.com/mcp`) needs OAuth, which can't complete in a cloud session; use the API-key config above. The real consent flow is checked by hand before directory submission (`.agents/runbooks/claude-directory.md`).
- `scripts/mcp-app-host.ts` imitates an MCP Apps host; it can't prove how Claude sizes or frames the view.
