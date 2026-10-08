# Headless development

Use this guide only in Cursor Cloud or another headless VM. For local development, use the normal root scripts.

## Runtime

Read the required Bun version from the root `packageManager` field. Install that exact version if Bun is unavailable.

`turbo watch` defaults to an interactive UI. In a headless session, set `TURBO_UI=false` for streaming output or run the required services separately.

## Bootstrap

Setup owns installation, Convex provisioning, and local configuration. It refuses production credentials, so it is safe to run anywhere. WorkOS AuthKit is the only sign-in provider, so export a WorkOS staging client ID and API key first (ask the human if none are available; never use production values):

```bash
export CONVEX_AGENT_MODE=anonymous
export WORKOS_CLIENT_ID=client_...
export WORKOS_API_KEY=sk_test_...
bun run setup
bun run doctor --json --target web --profile local
```

Setup installs dependencies with `bun ci`, preserves or provisions an isolated Convex development deployment (anonymous deployments run locally), configures the local `SITE_URL` default and the WorkOS client ID and API key, pushes backend code with `convex dev --once`, and derives `apps/web/.env.local` without overwriting custom values. Re-running setup changes nothing. Doctor reports `ok: true` when the tree is ready; it prints variable names and remediation only, never values.

Discover services with `bun run dev --help`, then start the web stack from the repository root:

```bash
bun run dev
```

The web app serves at the fixed URL `http://localhost:3000`. The port is pinned, so every agent and developer shares the same origin.

## First-run authentication

Sign-in goes through hosted WorkOS AuthKit: `/login` and `/sign-in` redirect there and it returns to `http://localhost:3000/callback`, which the staging environment already allows. Social sign-in is configured inside WorkOS, not in Teak.

For a headless session without the browser, `scripts/lib/workos-test-session.ts` creates a throwaway verified WorkOS user, signs in with a password, and returns the sealed `wos-session` cookie plus a `cleanup()` that deletes the user. `bun run smoke:web` uses it against the running stack. Always run the cleanup.

WorkOS webhooks go to the deployment registered in the WorkOS environment (the cloud development deployment for staging), never to a local anonymous backend.

The environment is ready when Convex and the web app remain running, `/` redirects to `/sign-in`, and `bun run smoke:web` passes.
