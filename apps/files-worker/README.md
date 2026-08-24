# @teak/files-worker

Serves private card files from `files.teakvault.com` and runs internal file
ops (image processing, export building, bounded inspection) at the edge.

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

Besides downloads, the worker executes short-lived signed ops minted per
action invocation (`packages/convex/storage/filesWorkerClient.ts`;
payload shape in `src/lib.ts`, param order in `src/index.ts` — keep both
sides in lockstep):

- `op=process-image` — decodes a card image over the R2 binding (raster via
  photon, HEIC via libheif, SVG via resvg — auto-detected from the bytes),
  applies EXIF orientation, optionally writes bounded lossy-WebP thumbnail +
  preview derivatives back to R2, and returns dimensions, dominant-color
  palette, EXIF facts, and a thumbhash placeholder (`src/image.ts`).
- `op=build-export` — streams a manifest-described set of objects through
  client-zip into a multipart-uploaded ZIP artifact (`src/export.ts`).
- `op=inspect` — bounded inspection returning facts or AI text without the
  object transiting Convex (`src/inspect.ts`): zip archives are walked via R2
  ranged reads (EOCD → central directory → selected entries) so memory stays
  flat regardless of archive size; `pdf` mode extracts page count + text via
  pdfium; `css`/`text` modes are byte-bounded as before.

Convex keeps orchestration; every op has a legacy in-action fallback for
local dev (no `FILES_BASE`/`FILES_SIGNING_SECRET`) and permanent rejections.

WASM modules are statically imported and arrive as build-time compiled
`WebAssembly.Module`s under wrangler (see `src/wasm.ts`).

## Commands

```bash
bun install
bun test            # unit + handler tests (fixtures in src/fixtures)
bun run typecheck   # tsc --noEmit (needs wrangler + workers-types deps)
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

Convex only emits worker URLs when both `FILES_BASE` and
`FILES_SIGNING_SECRET` are set on its deployment. Clearing either env var
falls back to the legacy presigned S3 URLs immediately.

Deploys automatically via Cloudflare Workers Builds (main branch).
