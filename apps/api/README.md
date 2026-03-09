# Teak API Gateway (`apps/api`)

Hono gateway for Teak public REST API and MCP server:

- REST: `https://api.teakvault.com/v1`
- MCP: `https://api.teakvault.com/mcp`

## Environment

- `CONVEX_HTTP_BASE_URL` (required)
  - Example: `https://uncommon-ladybug-882.convex.site`
  - Loaded automatically from `apps/api/.env` during `bun run dev`

## Local Development

```bash
cd apps/api
bun install
echo "CONVEX_HTTP_BASE_URL=https://uncommon-ladybug-882.convex.site" > .env
bun run dev
```

Local server is exposed through portless at `http://api.teak.localhost:1355`.

## Endpoints

- `GET /healthz`
- `GET /v1`
- `POST /v1/cards`
- `GET /v1/cards/search`
- `GET /v1/cards/favorites`
- `PATCH /v1/cards/:cardId`
- `DELETE /v1/cards/:cardId`
- `PATCH /v1/cards/:cardId/favorite`
- `ALL /mcp`
- `ALL /mcp/`

## Commands

```bash
bun run dev
bun run build
bun run start
bun run typecheck
bun run lint
bun run test
```
