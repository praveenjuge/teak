# Claude directory listing

Last reviewed: 2026-11-01

Teak is listed in Claude's directory (claude.ai/directory) twice, paired:

- **MCP connector**: the remote server `https://teakvault.com/mcp`. It reaches
  claude.ai, Claude Desktop, Claude mobile, Cowork and Claude Code.
- **Plugin bundle**: `plugins/teak` in `praveenjuge/teak`, mirrored to the
  root of `praveenjuge/teak-plugin` (the directory downloads a plugin's whole
  repository, and this one is over its 50 MiB limit). It adds the Teak skill and `/teak:save`, `/teak:search`, `/teak:recent`,
  and points at the same server URL so people with both see one set of tools.

Both are submitted and maintained by Praveen (Owner of the Claude
organization) at <https://claude.ai/directory/manage>. Anthropic's guides:
[submit a connector](https://claude.com/docs/connectors/building/submission),
[connector review criteria](https://claude.com/docs/connectors/building/review-criteria),
[authentication](https://claude.com/docs/connectors/building/authentication),
[submit a plugin](https://claude.com/docs/plugins/submit),
[plugin checklist](https://claude.com/docs/plugins/pre-submission-checklist).
Escalations: `mcp-review@anthropic.com` (connector), `directory@anthropic.com`
(plugin or listing ownership).

## What the server already meets

- Remote over HTTPS, Streamable HTTP, stateless JSON.
- OAuth: an unauthenticated call gets `401` with
  `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`;
  `resource` is exactly `https://teakvault.com/mcp`; the one authorization
  server is the production WorkOS AuthKit issuer, which advertises
  `client_id_metadata_document_supported: true`, `none` in
  `token_endpoint_auth_methods_supported`, PKCE `S256`, a
  `registration_endpoint` and `offline_access`. Claude therefore signs in
  with its Client ID Metadata Document: no Anthropic-held client is needed.
  Recheck with:

  ```bash
  curl -s https://teakvault.com/.well-known/oauth-protected-resource/mcp
  curl -s "$(curl -s https://teakvault.com/.well-known/oauth-protected-resource/mcp | jq -r '.authorization_servers[0]')/.well-known/oauth-authorization-server" \
    | jq '{client_id_metadata_document_supported, token_endpoint_auth_methods_supported, code_challenge_methods_supported, registration_endpoint}'
  ```

- Every tool has a `title` and `readOnlyHint`/`destructiveHint`
  (`packages/convex/mcp/protocol.ts`); deletes need `confirm: true`. Tool
  names are under 64 characters, and reads and writes are separate tools.
- The card view (`ui://teak/cards.html`, `packages/mcp-app`) is an MCP App:
  its sandbox origin is derived from the server URL, its CSP allows images
  from `files.teakvault.com` only, and it makes no network requests.

## Before changing the listing

When tools, sign-in or the card view change, re-check before you edit the
portal:

1. In a Claude organization, add `https://teakvault.com/mcp` as a custom
   connector, complete Teak's consent screen, and call each tool family:
   search, get, create, update, favorite, archive, tags, folders, highlights,
   delete (to Trash) and restore. The card view must render for search, get,
   list favorites and create. Repeat the sign-in in Claude Code
   (`claude mcp add --transport http teak https://teakvault.com/mcp`) and
   run the same calls through the MCP Inspector.
2. The reviewer account is a production Pro account the owner controls,
   seeded with `TEAK_API_KEY=... bun --no-env-file run scripts/seed/seed-demo-account.ts`
   (safe to re-run; revoke the key afterwards). Its password lives in the
   password manager and goes only into the portal's Test & launch step.
3. Carousel screenshots: 3–5 PNGs at least 1000px wide, cropped to the card
   view, one per prompt below, from the reviewer account. No video or GIFs.

## Connector portal answers

**Connection**: Universal URL, `https://teakvault.com/mcp`.

**Listing**

- Name: `Teak`
- One-liner (≤200): `Save, search and rediscover the links, images, notes, quotes and color palettes you keep in Teak, and see them as cards right in the conversation.`
- Description (≤2,000):

  > Teak is a personal knowledge hub for everything worth keeping: links,
  > images, videos, audio, documents, notes, quotes and color palettes. Connect
  > Teak to let Claude work with your library.
  >
  > - Search your cards by words or meaning, with qualifiers like `tag:design`,
  >   `type:link`, `site:github.com` and `is:fav`.
  > - Save links, notes and quotes while you talk. Saving a link you already
  >   have moves it to the top instead of making a copy.
  > - Read a card's AI summary, notes, the article text of a link, a
  >   document's text or a video's transcript.
  > - Organize with tags, folders, favorites and archive, and find cards
  >   similar to one you pick.
  > - See results as Teak cards in the conversation, with images, palettes
  >   and a link back to Teak.
  >
  > Deleting moves cards to Teak's Trash and always asks first. You need a
  > Teak account; the free plan holds 200 cards.

- Categories: Productivity, Creative (the portal has no research category).
- Documentation URL: `https://teakvault.com/docs/mcp`
- Privacy policy URL: `https://teakvault.com/docs/privacy-policy`
- Support contact: `hello@praveenjuge.com`
- Icon: `plugins/teak/.claude-plugin/icon.png` (1024×1024).
- Slug: `teak` (permanent once published).

**Allowed link URIs**: `https://app.teakvault.com`, `https://teakvault.com`.
"Visit source" opens third-party sites and keeps Claude's confirmation
prompt, which is expected.

**Use cases**

- Primary: find something you saved ("what did I save about onboarding
  flows?"); save a link or note from the conversation; organize cards into
  folders and tags; turn saved research into a summary or plan.
- Requirements: a Teak account (free or Pro), created at teakvault.com.
- Reads and writes data.

**Company**: Praveen Juge, `https://teakvault.com`, primary contact
`hello@praveenjuge.com`.

Claude only calls Teak when a prompt names it ("Show my favorite cards" gets a
question back), so every prompt below says "Teak".

**Authentication**: Always required. OAuth sign-in through the server's own
discovery (CIMD, falling back to DCR). No Anthropic-held client, no request
headers.

**Data handling**: Teak's own first-party API (the MCP server is a thin layer
over Teak's public API on the same domain). No personal health data. No
sponsored content.

**Test & launch**

> Sign in with the reviewer account [email] / [password] when Claude opens
> Teak's sign-in page, then approve the connection. The account holds about
> 45 cards: links (design, CSS, accessibility, note-taking), notes, quotes,
> five color palettes and six images, in the folders Design inspiration,
> Reading list and Redesign, plus a Palettes smart folder. Try: "Search my
> Teak for accessibility", "Show my favorite Teak cards", "Save
> https://en.wikipedia.org/wiki/Swiss_cheese_model to Teak with the tag
> risk", "Put my Teak cards about CSS into the Redesign folder", "Move the card you
> just saved to Trash".

Confirm every tool was run as a custom connector and in the MCP Inspector.

**Compliance**: all seven acknowledgements. Teak moves no money, generates no
images, video or audio, and collects no conversation data beyond each tool
call's arguments. Product analytics record only `mcp_tool_called` with the
tool name, outcome, status and duration (`.agents/guides/analytics.md`).

**Carousel prompts** (one screenshot each):

1. "Search my Teak for typography" (grid).
2. "Show my favorite Teak cards" (grid).
3. "Open my Dieter Rams Wikipedia card in full" (grid of the matches).
4. "Save https://en.wikipedia.org/wiki/Swiss_cheese_model to Teak" (saved).
5. "Show my color palettes in Teak" (grid of palettes).

## Plugin

The plugin listing points at `praveenjuge/teak-plugin` (plugin at the
repository root, branch `main`) and updates through the GitHub push webhook,
paired with the connector in the portal. Its data-handling answers: the
plugin stores no personal data, sends data only to its declared connector
(`https://teakvault.com/mcp`), and is not for people under 18.

`claude plugin validate ./plugins/teak` checks the plugin locally, and
`scripts/repo/claude-plugin.test.ts` checks that it names only real tools and the
same server URL as `server.json`. The plugin's `version` moves with every
release (`.agents/runbooks/releases.md`); the directory publishes passing
versions from `main`.

Edit the plugin only in `plugins/teak`. The Claude Plugin Sync workflow
(`.github/workflows/claude-plugin-sync.yml`) pushes `git subtree split
--prefix plugins/teak` to `praveenjuge/teak-plugin` on every `main` push that
touches it, with the write deploy key in the `TEAK_PLUGIN_DEPLOY_KEY` secret.
A push someone made to the mirror by hand makes the next sync fail; reset the
mirror to the split rather than forcing it from the workflow.

## After listing

- Server health and usage by tool: the connector's dashboard in the portal.
- Plugin installs and runs: the plugin's **Usage** tab.
- A changed tool list syncs from the server; listing text and categories
  change in the portal.
