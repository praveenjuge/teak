# @teak/files-worker

The single Cloudflare Worker for Teak file delivery, uploads, processing,
imports, and exports. It serves private card files from `files.teakvault.com`
and performs storage-heavy operations directly against its private R2 binding.

The Convex backend mints long-lived HMAC-signed URLs
(`packages/convex/storage/r2.ts` → `buildSignedWorkerFileUrl`). This worker
verifies the token, reads the object through an R2 binding, and streams it
with `Cache-Control: private, max-age=518400, immutable` (6 days; keep in
lockstep with `PRIVATE_FILE_CACHE_CONTROL` in r2.ts). It also handles single
HTTP `Range` requests (206 responses) so video/audio seeking works, serves
full-object responses from the Cloudflare edge cache keyed by object path +
content-disposition policy, answers conditional GETs with 304s, and supports
`HEAD`. The bucket is never public. `/__health` is an unauthenticated
liveness probe for uptime monitors.

## Internal ops

Besides downloads, the worker accepts body-bound, short-lived signed `POST`
requests at `/__ops/v1`. Contracts and typed success/error envelopes live in
`@teak/files-protocol`; `HEAD` and `GET` can never execute an operation.

- `op=process-image` — decodes a card image over the R2 binding (raster via
  photon, HEIC via libheif, SVG via resvg — auto-detected from the bytes),
  applies EXIF orientation, optionally writes bounded lossy-WebP thumbnail +
  preview derivatives back to R2, and returns dimensions, dominant-color
  palette, EXIF facts, and a thumbhash placeholder (`src/image.ts`).
- `build-export` — streams a manifest-described set of objects through
  client-zip into a checkpointed multipart ZIP upload that resumes after
  transient failures (`src/export.ts`).
- `inspect` — bounded inspection returning facts or AI text without the
  object transiting Convex (`src/inspect.ts`): zip archives are walked via R2
  ranged reads (EOCD → central directory → selected entries) so memory stays
  flat regardless of archive size; CSS and text modes are byte-bounded.
- `create-multipart`, `complete-multipart`, and `abort-multipart` coordinate
  resumable browser uploads. Signed `PUT /__uploads/v1/...` URLs accept only
  an exact upload id, object key, and part number.
- `finalize-upload` streams validated pending objects into their permanent
  key, and `extract-import-files` extracts bounded archive entries without
  sending file bytes through Convex.

Convex owns authorization, durable product state, and workflow orchestration;
this Worker is the one canonical implementation for file-byte operations.

WASM modules are statically imported and arrive as build-time compiled
`WebAssembly.Module`s under wrangler (see `src/wasm.ts`).

## Commands

```bash
bun install
bun test            # unit + handler tests (fixtures in src/fixtures)
bun run cf-typegen  # refresh generated Worker bindings/runtime types
bun run typecheck   # tsc --noEmit
bunx wrangler deploy --dry-run --outdir /tmp/out   # bundle size check
bun run deploy      # wrangler deploy (creates files.teakvault.com custom domain)
```

## Secrets

- `FILES_SIGNING_SECRET` — must match the `FILES_SIGNING_SECRET` env var on the
  Convex production deployment. Set with:
  `bunx wrangler secret put FILES_SIGNING_SECRET`
- `SENTRY_DSN` — DSN for error reporting (`@sentry/cloudflare`, errors only).
  Reporting stays disabled until this is set. Set with:
  `bunx wrangler secret put SENTRY_DSN`

Handled op failures (the 500 path) are reported explicitly with op/route,
HTTP method + path, and card/role identifiers parsed from the object key
(`src/sentry.ts`); anything that escapes the handler uncaught is captured
automatically. `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` are optional vars.

## Rollback

The Convex deployment requires both `FILES_BASE` and
`FILES_SIGNING_SECRET` for operations. Downloads can still use the existing
presigned-R2 fallback when the custom file domain is disabled.

Deploys automatically via Cloudflare Workers Builds (main branch).
