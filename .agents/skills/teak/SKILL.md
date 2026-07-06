---
name: teak
description: Use when an agent needs to save, search, retrieve, update, favorite, delete, or sync Teak cards through the Teak CLI, public API, MCP server, or TypeScript SDK.
---

# Teak Agent Skill

Teak is a personal knowledge hub for saving and rediscovering ideas, links, files, notes, quotes, palettes, and references. Use this skill when a user asks an agent to work with their Teak library or wire Teak into another workflow.

## Choose The Right Interface

- Prefer the CLI for local agent workflows, one-off automation, shell scripts, and user-facing commands.
- Prefer MCP when the current agent can call MCP tools directly and should expose Teak operations as tool calls.
- Prefer the API for integrations from non-TypeScript runtimes, backend services, or HTTP clients.
- Prefer the TypeScript SDK for Node.js or TypeScript apps that want typed helpers around the public API.

## Install And Authenticate

Install the CLI:

```bash
npm install -g teak-cli
```

Sign in with browser OAuth:

```bash
teak login
teak auth status
```

For CI, servers, or headless agents, use an API key instead of browser login:

```bash
export TEAK_API_KEY="teakapi_..."
teak --json cards list --limit 10
```

Never print, persist, or commit Teak API keys or OAuth tokens. Prefer environment variables or the user's secret manager. If a command fails with authentication errors, ask the user to run `teak login` or provide an API key through a secure channel.

## CLI Workflows

Save text:

```bash
teak add "Interesting design note" --tags design,research
```

Save a link:

```bash
teak add --url https://example.com --tags reference
```

Save a file:

```bash
teak add --file ./screenshot.png --notes "Homepage inspiration" --tags design
```

Search and inspect cards:

```bash
teak search "homepage inspiration" --limit 10
teak cards get <card-id>
```

Update, favorite, and delete:

```bash
teak cards update <card-id> --tags design,approved
teak fav <card-id>
teak rm <card-id>
```

Use `--json` for reliable parsing:

```bash
teak --json cards list --type link --limit 20
teak --json cards changes --since 0 --limit 50
teak --json tags
```

For destructive operations, confirm intent before deleting cards unless the user explicitly asked for cleanup. Deleting via the CLI moves cards to trash.

## Public API

Base URL:

```text
https://teakvault.com/api
```

Common endpoints:

```text
GET    /v1
GET    /v1/cards
POST   /v1/cards
POST   /v1/uploads
GET    /v1/cards/search
GET    /v1/cards/favorites
GET    /v1/cards/:cardId
PATCH  /v1/cards/:cardId
DELETE /v1/cards/:cardId
PATCH  /v1/cards/:cardId/favorite
GET    /v1/cards/changes
GET    /v1/tags
```

Authenticate with:

```text
Authorization: Bearer <OAuth access token or teakapi_ API key>
```

Use idempotency keys for retryable create requests from automation:

```bash
curl https://teakvault.com/api/v1/cards \
  -H "Authorization: Bearer $TEAK_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-workflow-step-id" \
  -d '{"content":"Saved by an agent","tags":["agent"]}'
```

For uploads, first create an upload, PUT the bytes to the returned `uploadUrl`, then create a card with `fileKey`, `fileName`, `fileSize`, `mimeType`, and `cardType`.

## MCP

MCP endpoint:

```text
https://teakvault.com/mcp
```

OAuth metadata:

```text
https://app.teakvault.com/.well-known/oauth-authorization-server
https://teakvault.com/.well-known/oauth-protected-resource/mcp
```

Use MCP for agents that can connect to streamable HTTP MCP servers. The server supports OAuth bearer tokens and Teak API keys. Confirm the tool list in the client before assuming a tool name; typical operations map to creating, searching, listing, updating, favoriting, and deleting cards.

## TypeScript SDK

The SDK lives at `@teak/convex/sdk` inside the Teak monorepo (`packages/convex/client/sdk.ts`). Import it from there and create a client:

```ts
import { createTeakClient, staticTokenProvider } from "@teak/convex/sdk";

const teak = createTeakClient({
  baseUrl: "https://teakvault.com/api",
  tokenProvider: staticTokenProvider(process.env.TEAK_API_KEY!),
});

const created = await teak.cards.create({
  content: "Saved from an agent workflow",
  source: "agent",
  tags: ["agent"],
});
```

Use the SDK for paginated listing, search, favorite toggles, direct uploads, and error handling. Catch SDK errors by `code` and surface actionable messages to the user.

## Agent Operating Rules

- Validate user-provided file paths and URLs before passing them to Teak.
- Do not upload files larger than 20 MB.
- Treat link, file, and note content as user data; do not summarize private content in logs unless the user asked.
- Prefer JSON output for automation and parse fields such as `cardId`, `pageInfo.nextCursor`, and `deletedIds`.
- Clean up temporary test cards after smoke tests.
- When testing production, create cards with a unique marker and delete them before finishing.
- If an operation is ambiguous, ask whether the user wants a new card, an update to an existing card, or a search.
- After changing Teak API, MCP, SDK, or CLI behavior, update the corresponding docs and run real local and production smoke tests.

## Useful Links

- CLI docs: https://teakvault.com/docs/cli
- API docs: https://teakvault.com/docs/api
- MCP docs: https://teakvault.com/docs/mcp
- Apps: https://teakvault.com/apps
