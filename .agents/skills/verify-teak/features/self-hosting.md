# Self-hosting

A self-hoster deploys their own Core Worker from `apps/core-worker/self-host/wrangler.jsonc` with `bun run deploy:self-host`, filling in their values from the ignored `self-host/.env` instead of editing a committed config. The first deploy, with `--with-secrets`, creates the R2 bucket and KV namespaces and uploads the secrets; later deploys keep both. Workers AI calls go through the account's `default` AI Gateway, which Cloudflare creates on the first call, unless `.env` names another gateway. Nothing reports to Teak's PostHog: each part sends analytics and error reports only to the self-hoster's own token, and a web app off Vercel only with `TEAK_ANALYTICS_ENABLED=true`.

## Sub-features

- `self-host-plan` checks `self-host/.env` (required keys, https origins, hostnames, unknown keys) and turns it into Wrangler `--var`, `--domain` and `--route` flags.
- `self-host-secrets` uploads `self-host/.env.secrets` only with `--with-secrets`, so a secret rotated later isn't undone.
- `self-host-copy` deploys the ignored `self-host/wrangler.deploy.jsonc`, so the IDs Wrangler writes back never touch the committed config.
- `self-host-boot` serves `/__health` and answers a signed `capabilities` request with every binding and cron present.
- `self-host-ai-gateway` sends Workers AI calls through `default` (or `AI_GATEWAY_ID` from `.env`) with request logging off.
- `self-host-telemetry` keeps every part silent without its own PostHog token, and lets a web app off Vercel report only with `TEAK_ANALYTICS_ENABLED=true`.

## How to get to it (user POV)

- The self-hosting guide, "Core Worker" (`/docs/self-hosting#core-worker`), then from `apps/core-worker`: copy `self-host/example.env` to `self-host/.env`, fill it in, and run `bun run deploy:self-host -- --with-secrets` (first deploy) or `bun run deploy:self-host`.
- The self-hosting guide, "Telemetry (optional)" (`/docs/self-hosting#telemetry-optional`): the web app's `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `TEAK_ANALYTICS_ENABLED`.
- In the Cloudflare dashboard after a real deploy: Workers → `teak-core-worker`; AI → AI Gateway → `default`.

## Driving it with Bash and Wrangler

Preconditions:

- No dev stack needed. Run from `apps/core-worker`. Use a throwaway `.env` with `example.com` values, `CONVEX_SITE_URLS=https://happy-otter-123.convex.site` and `FILES_PUBLIC_ORIGIN=https://files.example.com`, and a `.env.secrets` with the three required secrets set to `test`. Delete `self-host/.env`, `self-host/.env.secrets` and `self-host/wrangler.deploy.jsonc` when done.
- Steps marked **(account)** need a Cloudflare account on Workers Paid with `CLOUDFLARE_API_TOKEN`, and Docker for the Containers. Cloud sessions have neither, so report those steps as not reached.

Steps:

- **Missing `.env`.** With no `self-host/.env`: `bun run deploy:self-host` exits 1 with "Missing apps/core-worker/self-host/.env. Copy self-host/example.env…".
- **Plan and flags.** With the `.env`: `bun run deploy:self-host -- --dry-run --outdir <tmp> --containers-rollout=none` prints `wrangler deploy --config self-host/wrangler.deploy.jsonc --var CONVEX_SITE_URLS:… --var FILES_PUBLIC_ORIGIN:… --domain files.example.com …` and lists the bindings: 3 Durable Objects, 5 Workflows, `EDGE_IDENTITY` and `LINK_PAGE_CACHE` KV, 3 queues, `CARD_VECTORS_0`, `BUCKET (teak-files)`, `AI_GATEWAY_ID ("default")`. Add `API_PUBLIC_HOST=example.com` and `API_WORKOS_ISSUER=https://example.authkit.app`: four `--route example.com/…` flags appear. A typo key (`TYPO=1`) exits 1 with "Unknown keys in self-host/.env: TYPO".
- **Secrets.** Without the flag, the output says "Not uploading self-host/.env.secrets; pass --with-secrets to upload it." and the command has no `--secrets-file`. With `--with-secrets`, it has `--secrets-file self-host/.env.secrets` and the three secrets are listed as bindings. With the flag and no file, it exits 1 with "--with-secrets needs…".
- **Committed config untouched.** After any run, `git status --short --ignored self-host` shows `.env`, `.env.secrets` and `wrangler.deploy.jsonc` as ignored (`!!`), and `git diff self-host/wrangler.jsonc` is empty.
- **AI Gateway.** The dry run lists `env.AI_GATEWAY_ID ("default")`. Add `AI_GATEWAY_ID=my-gateway` to `.env`: the command has `--var AI_GATEWAY_ID:my-gateway`.
- **Boot.** `bunx wrangler dev --config self-host/wrangler.jsonc --local --port 8799 --enable-containers=false --var FILES_SIGNING_SECRET:test --var WORKFLOW_RPC_ROOT_SECRET:test --var EMAIL_INBOUND_SIGNING_SECRET:test --var CONVEX_SITE_URLS:https://happy-otter-123.convex.site --var FILES_PUBLIC_ORIGIN:http://localhost:8799`. Then `curl localhost:8799/__health` returns `{"ok":true}`. A signed `capabilities` op (`buildSignedWorkerOpRequest` from `packages/convex/storage/filesWorkerClient.ts`, with `FILES_BASE=http://localhost:8799 FILES_SIGNING_SECRET=test`) returns 200 with `ai`, `vectors`, `workflows` and `onboardingFiles` true and 13 crons. Signed with `FILES_SIGNING_SECRET=wrong`, it returns 403 `AUTH_INVALID`. Stop it with `pkill -f "wrangler dev --config self-host"`.
- **Web telemetry, server.** From `apps/web`, call the real `onRequestError` from `src/instrumentation.ts` in a Bun script that replaces `globalThis.fetch` and records each call, with `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_selfhosted_example` and `VERCEL_ENV` unset. With no `TEAK_ANALYTICS_ENABLED` (or `false`), nothing is sent. With `TEAK_ANALYTICS_ENABLED=true`, one POST goes to `https://us.i.posthog.com/batch/` carrying `phc_selfhosted_example`. With `VERCEL_ENV=preview TEAK_ANALYTICS_ENABLED=true`, nothing is sent; with `VERCEL_ENV=production`, one POST.
- **Web telemetry, client.** From `apps/web`, build with `env -u VERCEL_ENV NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_selfhosted_example TEAK_ANALYTICS_ENABLED=true bunx next build`: `grep -rl phc_selfhosted_example .next/static` finds a client chunk. Build again without `TEAK_ANALYTICS_ENABLED`: it finds none.
- **No Teak token.** `bun test scripts/repo/teak-posthog-token.test.ts` passes: Teak's token appears only in the production `wrangler.jsonc`, its generated types and `.agents/guides/analytics.md`.
- **(account) First deploy.** `bun run deploy:self-host -- --with-secrets` after creating the queues and the Vectorize index from the guide: Wrangler reports the bucket and both KV namespaces provisioned, and `git diff self-host/wrangler.jsonc` stays empty. A second `bun run deploy:self-host` provisions nothing new.
- **(account) Gateway.** Save a link card on a Convex deployment pointed at this Worker. AI → AI Gateway now lists `default`, with requests for the card's tags and summary. Opening a request shows no prompt or reply body.

## Gotchas

- `wrangler dev --local` reports AI and Vectorize as "not supported", but `capabilities` still sees the bindings; real AI calls need the **(account)** steps.
- Containers need Docker on the machine that deploys; `--containers-rollout=none` checks the Worker alone.
- Without `--with-secrets`, the first deploy fails with Wrangler's "required secrets have not been set" message, because a Worker that doesn't exist yet can't take `wrangler secret put`.
- A gateway with any name other than `default` must exist before the deploy that names it.
