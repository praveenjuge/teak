# Claude directory listing

Teak is listed in Claude's directory (claude.ai/directory) twice, paired:

- **MCP connector**: the remote server `https://teakvault.com/mcp`. It reaches
  claude.ai, Claude Desktop, Claude mobile, Cowork and Claude Code.
- **Plugin bundle**: `plugins/teak` in `praveenjuge/teak`, tracking `main`.
  It adds the Teak skill and `/teak:save`, `/teak:search`, `/teak:recent`,
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

## Before submitting the connector

1. Deploy the branch that adds the card view (Convex and the Core Worker),
   then confirm `resources/list` answers on production.
2. In a Claude organization, add `https://teakvault.com/mcp` as a custom
   connector (Settings → Connectors → Add custom connector), complete Teak's
   consent screen, and call each tool family from a conversation: search,
   get, create, update, favorite, archive, tags, folders, highlights, delete
   (to Trash) and restore. Check that the card view renders for search, get,
   list favorites and create. Repeat the sign-in in Claude Code
   (`claude mcp add --transport http teak https://teakvault.com/mcp`), which
   uses a loopback redirect on a random port.
3. Run the same calls through the MCP Inspector.
4. Create the reviewer account: a new Teak account on production with an
   address Praveen controls, upgraded to Pro so the card limit never gets in
   the way. Create an API key for it, then run
   `TEAK_API_KEY=... bun --no-env-file run scripts/seed-demo-account.ts`
   (safe to run again). Revoke that API key afterwards. Keep the password in
   the password manager; it goes only into the portal's Test & launch step.
5. Take 3–5 carousel screenshots (PNG, at least 1000px wide, cropped to the
   card view without the prompt), one per prompt below, in the reviewer
   account. Video and GIFs aren't accepted.

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

- Categories: Productivity; Knowledge & research (or the closest the portal
  offers).
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
> Teak for accessibility", "Show my favorite cards", "Save
> https://en.wikipedia.org/wiki/Swiss_cheese_model to Teak with the tag
> risk", "Put the CSS cards into the Redesign folder", "Move the card you
> just saved to Trash".

Confirm every tool was run as a custom connector and in the MCP Inspector.

**Compliance**: all seven acknowledgements. Teak moves no money, generates no
images, video or audio, and collects no conversation data beyond each tool
call's arguments. Product analytics record only `mcp_tool_called` with the
tool name, outcome, status and duration (`.agents/analytics.md`).

**Carousel prompts** (one screenshot each):

1. "Search my Teak for typography" (grid).
2. "Show my favorite cards" (grid).
3. "Open the Dieter Rams card" (card view).
4. "Save https://en.wikipedia.org/wiki/Swiss_cheese_model to Teak" (saved).
5. "Show my color palettes" (grid of palettes).

## Plugin submission

After the connector is submitted, from the same organization:

1. Connect GitHub on claude.ai with an account that can push to
   `praveenjuge/teak`.
2. Submit new → Plugin bundle. Repository `praveenjuge/teak`, plugin path
   `plugins/teak`, branch `main`. Validate; fix any blocking finding.
3. Data handling: no personal data stored by the plugin itself; it sends data
   only to its declared connector (`https://teakvault.com/mcp`); not for
   people under 18.
4. Keep **GitHub push webhook** for updates (needs admin on the repository).
5. Once both listings are live, pair the plugin with the connector in the
   portal.

`claude plugin validate ./plugins/teak` checks the plugin locally, and
`scripts/claude-plugin.test.ts` checks that it names only real tools and the
same server URL as `server.json`. The plugin's `version` moves with every
release (`.agents/releases.md`); the directory publishes passing versions
from `main` by the publish setting Anthropic applies.

## After listing

- Server health and usage by tool: the connector's dashboard in the portal.
- Plugin installs and runs: the plugin's **Usage** tab.
- A changed tool list syncs from the server; listing text and categories
  change in the portal.
