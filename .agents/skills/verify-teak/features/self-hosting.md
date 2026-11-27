# Self-hosting

A self-hoster deploys their own Core Worker from `apps/core-worker/self-host/wrangler.jsonc` with `bun run deploy:self-host`, taking their values from the ignored `self-host/.env`. The first deploy creates the R2 bucket and KV namespaces; later deploys keep them. Nothing reports to Teak's PostHog.

## Sub-features

- `self-host-plan` checks `self-host/.env` (required keys, https origins, hostnames, unknown keys) and turns it into `--var`, `--domain` and `--route` flags.
- `self-host-secrets` uploads `self-host/.env.secrets` only with `--with-secrets`, so a later-rotated secret isn't undone.
- `self-host-copy` deploys the ignored `self-host/wrangler.deploy.jsonc`, so IDs Wrangler writes back never touch the committed config.
- `self-host-boot` serves `/__health` and answers a signed `capabilities` request with every binding and cron.
- `self-host-ai-gateway` sends Workers AI calls through `default` (Cloudflare creates it on the first call), or `AI_GATEWAY_ID` from `.env`, with request logging off.
- `self-host-billing-off` (`BILLING_DISABLED=true` on Convex) gives every account Pro with no card limit, hides Plan from Settings and the command palette, sends `/settings/plan` to `/settings`, and refuses checkout and the billing portal.
- `self-host-telemetry` keeps every part silent without its own PostHog token, and the web app also without `TEAK_ANALYTICS_ENABLED=true`, at build time and on the Worker.

## How to get to it (user POV)

- Guide "Core Worker" (`/docs/self-hosting#core-worker`), then in `apps/core-worker`: copy `self-host/example.env` to `self-host/.env`, fill it in, run `bun run deploy:self-host -- --with-secrets` (first deploy) or `bun run deploy:self-host`.
- "Billing (optional)" (`/docs/self-hosting#billing-optional`): `bunx convex env set --prod BILLING_DISABLED true`.
- "Telemetry (optional)" (`/docs/self-hosting#telemetry-optional`): the web app's `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` and `TEAK_ANALYTICS_ENABLED`.
- After a real deploy, Cloudflare: Workers → `teak-core-worker`; AI → AI Gateway → `default`.

## Driving it with Bash and Wrangler

Preconditions:

- No dev stack. From `apps/core-worker`, use a throwaway `.env` with `example.com` values, `CONVEX_SITE_URLS=https://happy-otter-123.convex.site` and `FILES_PUBLIC_ORIGIN=https://files.example.com`, and a `.env.secrets` with the three required secrets as `test`. Delete them and `self-host/wrangler.deploy.jsonc` when done.
- **(account)** steps need a Workers Paid account with `CLOUDFLARE_API_TOKEN`, and Docker; cloud sessions have neither, so report them as not reached.

Steps:

- **Missing `.env`.** Without `self-host/.env`, `bun run deploy:self-host` exits 1 with "Missing apps/core-worker/self-host/.env. Copy self-host/example.env…".
- **Plan and flags.** `bun run deploy:self-host -- --dry-run --outdir <tmp> --containers-rollout=none` prints `wrangler deploy --config self-host/wrangler.deploy.jsonc --var CONVEX_SITE_URLS:… --var FILES_PUBLIC_ORIGIN:… --domain files.example.com …` and lists bindings: 3 Durable Objects, 5 Workflows, `EDGE_IDENTITY` and `LINK_PAGE_CACHE` KV, 3 queues, `CARD_VECTORS_0`, `BUCKET (teak-files)`, `AI_GATEWAY_ID ("default")`. `API_PUBLIC_HOST=example.com` plus `API_WORKOS_ISSUER=https://example.authkit.app` adds four `--route example.com/…` flags. `TYPO=1` exits 1 with "Unknown keys in self-host/.env: TYPO".
- **Secrets.** Without `--with-secrets`, the output says "Not uploading self-host/.env.secrets; pass --with-secrets to upload it." and there's no `--secrets-file`. With it, the command has `--secrets-file self-host/.env.secrets` and lists the three secrets as bindings; with no file, it exits 1 with "--with-secrets needs…".
- **Committed config untouched.** After each run, `git status --short --ignored self-host` shows `.env`, `.env.secrets` and `wrangler.deploy.jsonc` as `!!`, and `git diff self-host/wrangler.jsonc` is empty.
- **AI Gateway.** With `AI_GATEWAY_ID=my-gateway` in `.env`, the dry run has `--var AI_GATEWAY_ID:my-gateway`.
- **Boot.** `bunx wrangler dev --config self-host/wrangler.jsonc --local --port 8799 --enable-containers=false --var FILES_SIGNING_SECRET:test --var WORKFLOW_RPC_ROOT_SECRET:test --var EMAIL_INBOUND_SIGNING_SECRET:test --var CONVEX_SITE_URLS:https://happy-otter-123.convex.site --var FILES_PUBLIC_ORIGIN:http://localhost:8799`. `curl localhost:8799/__health`: `{"ok":true}`. A signed `capabilities` op (`signedOpRequest` from `packages/convex/storage/coreWorkerClient.ts`, with `FILES_BASE=http://localhost:8799 FILES_SIGNING_SECRET=test`) returns 200: `ai`, `vectors`, `workflows` and `onboardingFiles` true, 13 crons and `operations` equal to `FILES_NETWORK_OPS` from `@teak/files-protocol`. Signed with `FILES_SIGNING_SECRET=wrong`: 403 `AUTH_INVALID`. A Worker-internal op (`fetch-link-page`): 400 `UNSUPPORTED`. Stop with `pkill -f "wrangler dev --config self-host"`.
- **Web telemetry, build.** From `apps/web`, build with `env -u POSTHOG_CLI_API_KEY VITE_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_selfhosted_example TEAK_ANALYTICS_ENABLED=true bunx vite build` (skipping the source map upload): `grep -rl phc_selfhosted_example dist/client` and `grep -l phc_selfhosted_example dist/server/index.js` both match. Without `TEAK_ANALYTICS_ENABLED`, `grep -rl phc_selfhosted_example dist` finds nothing. Rebuild without the token at the end.
- **Web telemetry, runtime.** Worker error reports (`reportRequestError`, `src/server.ts`) gate on runtime `TEAK_ANALYTICS_ENABLED` via `resolvePostHogToken` (`src/lib/analyticsGate.ts`). In Bun, `resolvePostHogToken({ analyticsEnabled: "true", token: "phc_selfhosted_example" })` returns the token; `undefined`, `"false"` or `"1"` return `undefined`.
- **Own project for deletions.** `bun test packages/convex/__tests__/accountDeletion/analytics.test.ts packages/convex/__tests__/shared/posthog.test.ts`: with `POSTHOG_PROJECT_ID=12345`, deletion posts to `/api/projects/12345/persons/bulk_delete/`; unset, it posts to Teak's `660923`.
- **No Teak token.** `bun test scripts/repo/teak-posthog-token.test.ts` passes (Teak's token only in the production `wrangler.jsonc`, its generated types and `.agents/guides/analytics.md`).
- **Billing off (local stack).** On `bun run dev --local --detach`, run `convex` commands from `packages/convex` with `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous` and check each reports `anonymous deployment`, never the shared dev deployment. As the seeded account, on `/settings` the nav "Settings pages" lists "Plan", the Plan row has link "Upgrade to Pro", and "Cards used" reads "<n> of 200 cards". With an API key from Integrations ([settings](./settings.md)), `GET <apiOrigin>/v1/me` has `plan` `"free"`, `cardLimit` 200. After `bunx convex env set BILLING_DISABLED true`, reload `/settings`: the nav has no "Plan", the Plan row shows badge "Pro" without a link, "Cards used" reads "<n> cards saved, with no limit.", and nothing links to `/settings/plan`. `/settings/plan` lands on `/settings`. Control+K, "plan": no "Settings: Plan". `GET /v1/me`: `plan` `"pro"`, `cardLimit` `null`. Then `bunx convex env remove BILLING_DISABLED` and revoke the key.
- **(account) First deploy.** After creating the guide's queues and Vectorize index, `bun run deploy:self-host -- --with-secrets`: Wrangler provisions the bucket and both KV namespaces; `git diff self-host/wrangler.jsonc` stays empty. A second `bun run deploy:self-host` provisions nothing.
- **(account) Gateway.** Save a link card on a Convex deployment using this Worker: AI → AI Gateway lists `default` with requests for its tags and summary, none showing a prompt or reply body.

## Gotchas

- `wrangler dev --local` reports AI and Vectorize "not supported", but `capabilities` still sees the bindings; real AI calls need **(account)** steps.
- Containers need Docker to deploy; `--containers-rollout=none` checks the Worker alone.
- Without `--with-secrets`, the first deploy fails with "required secrets have not been set": a Worker that doesn't exist can't take `wrangler secret put`.
- A gateway other than `default` must exist before the deploy naming it.
