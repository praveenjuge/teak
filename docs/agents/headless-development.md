# Headless development

Use this guide only in Cursor Cloud or another headless VM. For local development, use the normal root scripts.

## Runtime

Read the required Bun version from the root `packageManager` field. Install that exact version if Bun is unavailable.

`turbo watch` defaults to an interactive UI. In a headless session, set `TURBO_UI=false` for streaming output or run the required services separately.

## Bootstrap

Setup owns installation, Convex provisioning, and local configuration. It refuses production credentials, so it is safe to run anywhere:

```bash
export CONVEX_AGENT_MODE=anonymous
bun run setup
bun run doctor --json --target web --profile local
```

Setup installs dependencies with `bun ci`, preserves or provisions an isolated Convex development deployment (anonymous deployments run locally), configures the local `SITE_URL`, pushes backend code with `convex dev --once`, and derives `apps/web/.env.local` without overwriting custom values. Re-running setup changes nothing. Doctor reports `ok: true` when the tree is ready; it prints variable names and remediation only, never values.

Discover services with `bun run dev --help`, then start the web stack from the repository root:

```bash
bun run dev
```

The web app serves at the fixed URL `http://localhost:3000`. The port is pinned, so every agent and developer shares the same origin.

## First-run authentication

Email sign-in works without external OAuth credentials. Google and Apple sign-in stay visible but report a clear unavailable message until their credentials are configured; test values are acceptable for OAuth credentials in local development. `JWKS` is generated as the array expected by the installed `@convex-dev/better-auth` version; consult its current documentation instead of copying a stale shape.

Better Auth validates the browser origin. If authentication reports `Invalid origin`, set `SITE_URL` to the exact browser origin, wait for Convex to redeploy, and retry.

Test users can be marked verified through the existing internal test-setup endpoint. Inspect its current validator and route before calling it; do not cache a request contract here.

The environment is ready when Convex and the web app remain running, the login page loads at the printed localhost URL, and a test session can authenticate without an origin error.
