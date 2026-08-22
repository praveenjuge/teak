# @teak/files-worker

Serves private card files from `files.teakvault.com`.

The Convex backend mints short-lived HMAC-signed URLs
(`packages/convex/storage/r2.ts` → `buildSignedWorkerFileUrl`). This worker
verifies the token, reads the object through an R2 binding, and streams it
with `Cache-Control: private, max-age=900, immutable`. The bucket is never
public.

## Commands

```bash
bun install
bun test            # signing/verification unit tests
bun run typecheck   # tsc --noEmit (needs wrangler + workers-types deps)
bun run deploy      # wrangler deploy (creates files.teakvault.com custom domain)
```

## Secrets

- `FILES_SIGNING_SECRET` — must match the `FILES_SIGNING_SECRET` env var on the
  Convex production deployment. Set with:
  `bunx wrangler secret put FILES_SIGNING_SECRET`

## Rollback

Convex only emits worker URLs when both `FILES_BASE` and
`FILES_SIGNING_SECRET` are set on its deployment. Clearing either env var
falls back to the legacy presigned S3 URLs immediately.

Deploys automatically via Cloudflare Workers Builds (main branch).
