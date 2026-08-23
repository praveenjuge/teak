# @teak/files-worker

Serves private card files from `files.teakvault.com` and runs internal file
ops (image processing, export building, bounded inspection) at the edge.

The Convex backend mints long-lived HMAC-signed URLs
(`packages/convex/storage/r2.ts` → `buildSignedWorkerFileUrl`). This worker
verifies the token, reads the object through an R2 binding, and streams it
with `Cache-Control: private, max-age=518400, immutable` (6 days; keep in
lockstep with `PRIVATE_FILE_CACHE_CONTROL` in r2.ts). It also handles single
HTTP `Range` requests (206 responses) so video/audio seeking works, and serves
full-object responses from the Cloudflare edge cache keyed by object path +
content-disposition policy. The bucket is never public.

## Internal ops

Besides downloads, the worker executes short-lived signed ops minted per
action invocation (`packages/convex/storage/filesWorkerClient.ts`; payload
shape in `src/lib.ts`, param order in `src/index.ts` — keep both sides in
lockstep):

- `op=process-image` — decodes a card image over the R2 binding, applies EXIF
  orientation, optionally writes a bounded WebP thumbnail back to R2, and
  returns dimensions plus a dominant-color palette (`src/image.ts`).
- `op=build-export` — streams a manifest-described set of objects through
  client-zip into a multipart-uploaded ZIP artifact (`src/export.ts`).
- `op=inspect` — bounded zip/CSS/text inspection returning facts or AI text
  without the object transiting Convex (`src/inspect.ts`).

Convex keeps orchestration; every op has a legacy in-action fallback for
local dev (no `FILES_BASE`/`FILES_SIGNING_SECRET`) and permanent rejections.

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
