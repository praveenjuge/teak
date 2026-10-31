# Teak in Claude

People connect Teak to Claude (claude.ai, Desktop, mobile, Cowork, Claude Code) through the MCP server, from Claude's connector directory or as a custom connector, and Claude Code users can install Teak's plugin from this repository. When Claude searches, lists, opens or saves cards, clients that show MCP Apps render them as Teak cards in the conversation instead of JSON. The plugin adds a Teak skill and `/teak:save`, `/teak:search` and `/teak:recent`.

## Sub-features

- `mcp-app-resource` lists one resource, `ui://teak/cards.html` (`text/html;profile=mcp-app`), in `resources/list`, answered at the edge and in Convex alike. `resources/read` returns the view's HTML with `_meta.ui`: `csp.resourceDomains` holding only the deployment's files origin (`https://files.teakvault.com` in production, the dev Core Worker on dev), `connectDomains` empty, `prefersBorder: true`, and `domain` set to Claude's sandbox origin for the deployment's MCP URL (the first 32 hex characters of its SHA-256, then `.claudemcpcontent.com`). Any other `uri` answers `-32002`.
- `mcp-app-tools` marks exactly `teak_v1_search_cards`, `teak_v1_list_cards`, `teak_v1_list_favorite_cards`, `teak_v1_get_card` and `teak_v1_create_card` with `_meta.ui.resourceUri` (and the legacy `ui/resourceUri`).
- `mcp-app-views` shows a search as "Results for “<q>”" with a count, favorites as "Favorites", a list as "Recent cards", one card with its image, summary, notes, tags, "Open in Teak" and "Visit source", and a save as "Saved to Teak" (or "Already in Teak, moved to the top"). Notes and quotes show their text without a repeated title or Markdown marks; palettes show their colors; a card without a title shows only its type or site. Clicking a card or "Open in Teak" asks the host to open the card's `appUrl` (`ui/open-link`).
- `mcp-app-host` follows the host's theme (light, dark) and language (any of the eight; `pt-PT` → Portuguese (Brazil), `zh-CN` → Simplified Chinese, others → English), and reports its height.
- `claude-plugin` validates (`claude plugin validate ./plugins/teak` and `.`), installs from this repository's marketplace (`teak@teak`) with the skill and three commands, and its `/teak:search` runs `teak_v1_search_cards` and summarizes real cards.
- `demo-seed` (`scripts/seed-demo-account.ts`) fills an account with about 45 cards, six images, three folders, a smart folder and favorites, and a second run saves nothing.

## How to get to it (user POV)

- Claude: Settings → Connectors → Teak (or Add custom connector with the MCP URL), then ask Claude to search, show favorites, open a card or save a link. Claude itself can't be driven from a cloud session; drive the view through `scripts/mcp-app-host.ts`, which plays the host.
- Claude Code: `/plugin marketplace add praveenjuge/teak`, `/plugin install teak@teak`, then `/teak:search <words>`.
- MCP: `POST https://reminiscent-kangaroo-59.convex.site/mcp` with an API key, as in [api-cli-mcp](./api-cli-mcp.md).

## Driving it with curl, scripts/mcp-app-host.ts and the claude CLI

Mint a key first (`bun .agents/skills/verify-teak/scripts/api-key.ts mint`), with `SITE` and `H` as in [api-cli-mcp](./api-cli-mcp.md). Evidence goes to `.agents/.state/verify/<run-id>/`.

- **Resource.** `curl -sS "${H[@]}" $SITE/mcp -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}'` lists `ui://teak/cards.html`. `… -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"ui://teak/cards.html"}}' > $E/resources-read.json`: check `.result.contents[0]._meta.ui` as in `mcp-app-resource`; compute the expected domain with `node -e 'console.log(require("crypto").createHash("sha256").update("https://reminiscent-kangaroo-59.convex.site/mcp").digest("hex").slice(0,32))'`. The `text` equals `TEAK_APP_HTML` in `packages/convex/mcp/appHtml.generated.ts` once the dev deployment runs this checkout (doctor: "this checkout is pushing").
- **Tools.** `… -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}' | jq '[.result.tools[] | select(._meta) | .name]'` lists the five tools in `mcp-app-tools`.
- **Views.** `bun .agents/skills/verify-teak/scripts/mcp-app-host.ts $E verify-<run-id>` reads the view, calls search ("design"), favorites, recent, get (the first link found) and, with the marker, create (`https://example.com/<marker>`), then renders each in light, dark and Japanese under the resource's CSP. It saves `mcp-app-<view>-<theme>-<locale>.png`, `mcp-app-report.json` (images loaded, CSP or script problems, the URL each click asked to open) and exits 1 on any problem or broken image. Look at the screenshots: titles, counts, buttons and images as in `mcp-app-views`, all text in Japanese in the `ja-JP` shots.
- **Plugin.** With a scratch config so your own Claude Code settings stay untouched: `CFG=$(mktemp -d)`, then `claude plugin validate ./plugins/teak && claude plugin validate .`, `CLAUDE_CONFIG_DIR=$CFG claude plugin marketplace add ./`, `CLAUDE_CONFIG_DIR=$CFG claude plugin install teak@teak`, `CLAUDE_CONFIG_DIR=$CFG claude plugin list` (teak 1.0.x, enabled). To run a command against dev, write an MCP config (in the scratch folder, mode 600) with a server `teak` at `$SITE/mcp` and an `Authorization: Bearer <key>` header, then `CLAUDE_CONFIG_DIR=$CFG claude -p "/teak:search design" --strict-mcp-config --mcp-config <file> --allowedTools mcp__teak__teak_v1_search_cards --output-format stream-json --verbose --max-turns 6`: the stream shows a `teak_v1_search_cards` call with `q: "design"`, and the result lists real card titles. Delete the config file afterwards.
- **Seed.** `bun --no-env-file run scripts/seed-demo-account.ts --api $SITE --dry-run` lists what it would save. A real run adds about 45 cards and four folders to the seeded account: snapshot `GET $SITE/v1/cards?limit=100` ids and `GET $SITE/v1/folders` first, run it twice (the second prints "Saved 0 cards"), then permanently delete every card not in the snapshot and the folders Design inspiration, Reading list, Redesign and Palettes.

## Gotchas

- The view is built from `packages/mcp-app` into `packages/convex/mcp/appHtml.generated.ts`; after changing the view, run `bun run build` in `packages/mcp-app` (its test fails when they differ), and let the dev stack push before reading the resource.
- The dev deployment's `appUrl` points at `http://localhost:3000`, and its sandbox domain and files origin are dev's own, not production's.
- Link images come from the dev Core Worker's renderer; screenshots taken before 31 Oct 2026 can be unstyled pages (they were rendered from the fetched page, not the saved copy). That's old data, not the view.
- Browser sign-in (OAuth) can't complete in a cloud session: the plugin's own server (`https://teakvault.com/mcp`) needs it, so drive commands with the API-key config above. The real Claude consent flow is checked by hand before a directory submission (`.agents/claude-directory.md`).
- `scripts/mcp-app-host.ts` imitates a host from the MCP Apps spec; it doesn't prove how Claude itself sizes or frames the view.
