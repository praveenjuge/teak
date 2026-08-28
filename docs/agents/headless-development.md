# Headless development

Use this guide only in Cursor Cloud or another headless VM. For local development, use the normal root scripts.

## Runtime

Read the required Bun version from the root `packageManager` field. Install that exact version if Bun is unavailable, then run `bun install --frozen-lockfile` from the repository root.

`turbo watch` expects an interactive UI. In a headless session, set `TURBO_UI=tui` or run the required services separately.

## Minimal web stack

Start Convex from `packages/convex` in a persistent session:

```bash
export CONVEX_AGENT_MODE=anonymous
bun run dev
```

Start the web app from `apps/web` in another persistent session:

```bash
bunx portless app.teak next dev
```

Use the localhost URL printed by Portless. Do not assume a fixed port.

Create `apps/web/.env.local` from the active Convex deployment values. A local anonymous deployment normally uses:

```dotenv
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
```

## First-run authentication

Set the anonymous Convex deployment's Google client values, `SITE_URL`, and `JWKS`. Test values are acceptable for OAuth credentials in local development. Generate `JWKS` as the array expected by the installed `@convex-dev/better-auth` version; consult its current documentation instead of copying a stale shape.

Better Auth validates the browser origin. If authentication reports `Invalid origin`, set `SITE_URL` to the exact browser origin, wait for Convex to redeploy, and retry.

Test users can be marked verified through the existing internal test-setup endpoint. Inspect its current validator and route before calling it; do not cache a request contract here.

The environment is ready when Convex and the web app remain running, the login page loads at the printed localhost URL, and a test session can authenticate without an origin error.
