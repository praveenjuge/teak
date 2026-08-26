# @teak/files-worker

The Cloudflare Worker for Teak file delivery, uploads, processing, imports,
and exports. Production serves `files.teakvault.com` from `teak-files-prod`;
the isolated development environment serves `files-dev.teakvault.com` from
`teak-files-dev`. Both buckets remain private.

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

The worker also owns the Images (`IMAGES`) and Workers AI (`AI`) bindings:
only unique transformed variants (`tiny`, `compact`, `grid`, `detail`) consume
Image Transformations, and image understanding runs on Workers AI inside the
worker. Eligible sources (≤20 MB) are transformed directly from R2 through
the binding, cached per source ETag + rendition + format; larger sources keep
the URL-based transformation path. The Convex backend remains the control plane — it authenticates
users, owns card state, validates uploads, and orchestrates workflows —
while every byte-processing operation (uploads, deletes, analysis, AI,
generated media) flows through this worker.

## Internal ops

Besides downloads, the worker accepts body-bound, short-lived signed `POST`
requests at `/__ops/v1`. Contracts and typed success/error envelopes live in
`@teak/files-protocol`; `HEAD` and `GET` can never execute an operation.

- `op=analyze-image` / `analyze-image-content` — reads intrinsic dimensions
  and a bounded color sample through Cloudflare transformations; SVG input is
  rasterized with resvg. Renditions are generated on demand and no image
  derivative is written to R2. `analyze-image-content` is the additive alias;
  both are accepted so Worker and Convex deployments overlap safely.
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
  key, `finalize-image-upload` decode-verifies image uploads first (decoded
  format, dimensions, and size are returned as trusted facts to Convex), and
  `extract-import-files` extracts bounded archive entries without sending file
  bytes through Convex.
- `delete-object` removes one object; `delete-objects` accepts at most 100
  keys per batch and treats missing objects as success. Durable deletion is
  orchestrated by the Convex object-cleanup workflow.
- `head-object` returns existence, size, ETag, and content type for a key —
  used to verify Kernel-generated media after direct uploads before Convex
  records it.
- `list-objects` pages objects under a `users/` prefix (limit ≤1000, opaque
  cursor) — used by the stale pending-upload sweep and the weekly
  orphaned-object reconciliation report.
- `generate-image-metadata` feeds the existing `detail` rendition into
  Workers AI (Gemma multimodal) with the same system prompt, JSON output
  shape, and bounded validation retries as the pipeline it replaced; image
  bytes never leave the worker (`src/imageMetadata.ts`).

## Single-file signed uploads

`PUT /__upload/v1/<key>?exp&sig&ct[&sz]` accepts small user uploads,
Convex-validated remote assets, export manifests, and Kernel-generated media
(screenshots, PDF/video thumbnails). The HMAC binds the HTTP method, exact
object key, expiry (≤15 minutes), content type, and — when known ahead of
time — the expected byte size. Omitting the `ct` param leaves the content
type unbound: the signature is computed with an empty content type and the
request's validated `Content-Type` header is stored verbatim (used when the
encoding is decided at generation time, e.g. WebP-vs-JPEG video frames).
`Content-Length` is mandatory, oversized bodies are rejected, and keys must
live under a `users/<id>/...` prefix with no traversal segments
(`src/upload.ts`). Server-generated media signs without a bound size and
relies on the worker's hard cap instead.

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
bunx wrangler deploy --env development # deploys files-dev.teakvault.com
```

## Secrets

- `FILES_SIGNING_SECRET` — must match its corresponding Convex deployment.
  Set production with `bunx wrangler secret put FILES_SIGNING_SECRET` and
  development with
  `bunx wrangler secret put FILES_SIGNING_SECRET --env development`.
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
The development Worker is deployed explicitly with `--env development` so
development data can never be read through the production bucket binding.
