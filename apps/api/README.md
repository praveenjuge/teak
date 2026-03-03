# Teak API Gateway (`apps/api`)

Thin Hono proxy for Teak public API routes served at `https://api.teakvault.com/v1`.

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

Local server defaults to `http://localhost:8787`.

## Endpoints

- `GET /healthz`
- `GET /v1`
- `POST /v1/cards`
- `GET /v1/cards/search`
- `GET /v1/cards/favorites`
- `PATCH /v1/cards/:cardId`
- `DELETE /v1/cards/:cardId`
- `PATCH /v1/cards/:cardId/favorite`

## Commands

```bash
bun run dev
bun run build
bun run start
bun run typecheck
bun run lint
bun run test
```
