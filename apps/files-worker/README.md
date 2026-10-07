# @teak/files-worker

The Cloudflare Worker for Teak file delivery, uploads, processing, imports,
and exports. Production serves `files.teakvault.com` from `teak-files-prod`
through `wrangler.jsonc`. Development currently shares that Worker and bucket
under `dev/users/...`, separated only by the key prefix and with shared
credentials. The pre-convergence `files-dev` Worker/domain and `teak-files-dev`
bucket were retired after the legacy dev references reached zero.

`development/wrangler.jsonc` prepares the isolated target: the
`teak-files-development` workers.dev Worker on the private
`teak-files-development-20261006` bucket, with its own Durable Object namespace
and signing key, running this same source. It is inactive until the approved
storage switch points Convex dev at it; see "Development storage isolation".

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
while stored-file processing and storage transfers flow through this worker.
Remote preview fetching retains its DNS-pinned Convex implementation (see below);
PDF/video rendering and screenshots remain in Kernel.

## Internal ops

Besides downloads, the worker accepts body-bound, short-lived signed `POST`
requests at `/__ops/v1`. Contracts and typed success/error envelopes live in
`@teak/files-protocol`; `HEAD` and `GET` can never execute an operation.
Operation request bodies are limited to 1 MiB before signature verification.

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
- `list-objects` pages objects under a `users/` (prod) or `dev/users/`
  (dev) prefix (limit ≤1000, opaque cursor) — used by the stale
  pending-upload sweep and the weekly orphaned-object reconciliation report.
  The production Worker accepts both prefixes so dev traffic can share the
  prod bucket.
- `generate-image-metadata` feeds the existing `detail` rendition into
  Workers AI (Gemma multimodal) with the same system prompt, JSON output
  shape, and bounded validation retries as the pipeline it replaced; image
  bytes never leave the worker (`src/imageMetadata.ts`).

## Import and audio processing

- `transcribe-audio` accepts an authorized R2 source key and optional MIME hint.
  The AI binding streams the R2 body to `@cf/openai/whisper-large-v3-turbo`.
  Audio is limited to the existing 100 MiB upload limit; returned UTF-8 text
  is limited to 512 KiB. Results contain text, byte count, MIME type, and source
  ETag, never segments or audio bytes. Convex retains AI telemetry and optional
  enrichment failure semantics; card processing status and retries stay there.
- `index-import-source` accepts archive/bookmarks/raindrop, expected source size,
  and an offset cursor. It returns at most 100 items and 4 MiB of item JSON;
  continuation requests bind the original ETag. The import action binds
  that ETag to the job before storing rows and uses it during extraction. Convex owns card
  validation, deduplication across pages, cancellation, and database writes.
- `read-import-markdown` returns one UTF-8 Markdown entry (512 KiB maximum),
  or a typed per-item decoding/size failure. Convex decides whether a legacy
  document becomes a text card. Import writes are batched by both item count
  and encoded size after Markdown expansion.
- ZIP inspection, indexing, and `extract-import-files` share `src/zip.ts`.
  Ranged reads support classic ZIP and ZIP64 offsets within the existing 5 GiB
  archive/expanded-byte limits. Central directories are capped at 32 MiB and
  20,002 entries (10,000 cards plus files and metadata). Multi-disk, encrypted,
  duplicate, traversal, and unsupported-compression entries are rejected.
  Every read checks source ETag; local headers and actual decompressed sizes
  are checked before extracted files are stored under the same user namespace.
- Import JSON retains its 64 MiB byte limit and is parsed incrementally with
  completed siblings discarded. Only the requested page is retained. Defensive
  limits also bound JSON nesting (64), string tokens (1 MiB), and individual
  in-progress values (4 MiB). Extraction/preview entries retain the 100:1
  compression-ratio guard; JSON and Markdown use actual streamed byte limits
  so highly compressible valid text remains importable.
- The canonical pure bookmark/CSV parsers remain in `packages/convex/import`
  and are imported directly by the worker. They execute in the worker for
  imports; no second parser or S3 fallback exists. Sources remain capped at
  20 MiB and 10,000 bookmarks. HTML is parsed without building a DOM, with a
  nesting limit of 128; CSV is limited to 256 columns and assembles quoted
  fields in bounded chunks.
- Convex generates bounded error-report excerpts and uploads them through the
  existing signed PUT endpoint. Source/report cleanup is handed to the durable
  object-deletion workflow before import rows are removed. Multipart abort is
  idempotent only for R2 `NoSuchUpload` (10024); other errors propagate.

### Remote preview ingestion: retained security boundary

`workflows/steps/linkMetadata/fetchMetadata.ts` still downloads remote preview
assets using the existing DNS validation, pinned address set, redirect checks,
byte/type limits, and dimensions checks, then uploads through the worker.
Moving this fetch without equivalent connection pinning would permit DNS
rebinding between validation and connection.

The [Workers HTTP API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
does not implement `lookup` or `createConnection`.
[`resolveOverride`](https://developers.cloudflare.com/workers/runtime-apis/request/#requestinitcfproperties)
is restricted to hosts in the zone and cannot pin arbitrary external preview
hosts. A local workerd probe using the existing Undici Agent with a custom
lookup failed before calling lookup with
`ERR_OPTION_NOT_IMPLEMENTED: The options.ALPNProtocols option is not implemented`.
This was reproduced on 2026-09-12 with both repository Wrangler 4.125.0 and
latest Wrangler 4.131.1. Replacing the transport with custom TLS/HTTP shims
is outside this consolidation. The protected Convex path remains canonical.

### Verification and deployment boundary

Deterministic tests cover signed routes, pagination, source replacement, ZIP64
reads beyond 4 GiB, unsafe entries, actual decompression limits, Markdown
outcomes, and binding input/output limits. `packages/convex/importConsolidation.test.ts`
checks real Convex mutation state for deduplication, action replay, cancellation,
and rejected source changes using the edge test runtime.

Local workerd verification used a separate config with a local-only R2 bucket
and test signing secret. It exercised upload, 103-card indexing over two pages,
Markdown, file extraction, HTML/CSV, and cleanup. The real AI binding was tested
with synthetic speech streamed from local R2; no production objects were written.
The streaming binding contract is also documented in the
[Cloudflare binding implementation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts).

Deploy the worker operations before their Convex callers. The backend deployment
runs `bun run scripts/check-files-readiness.ts --prod --wait`: an authenticated,
read-only capability probe must confirm the required operations and AI/Images
bindings before Convex deploys. It waits at most ten minutes for Cloudflare Builds.

The first index step retains its original function reference and arguments.
Old journal results have no continuation cursor and follow their existing step
sequence. New imports checkpoint one page per action and deduplicate across
pages using the job/URL index. Markdown reads run eight at a time. The optional `importJobs.sourceEtag` is bound atomically
inside indexing/extraction, so existing journals can resume without a restart
or backfill. A local backend plus real R2 run indexed 10,000 items (about
55 MiB of JSON, including 256 Markdown files) across 100 pages in 391 seconds.
The longest Markdown-heavy page took 44 seconds; all fixtures were cleaned up. Before rollback, retain this optional schema field while reverting
callers; reverting to a schema that rejects stored ETags requires a separate,
explicitly approved data migration. Keep the compatible worker deployed while
rolling back backend callers.

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
live under a `users/<id>/...` (or `dev/users/<id>/...` for dev) prefix
with no traversal segments (`src/upload.ts`). Server-generated media signs
without a bound size and relies on the worker's hard cap instead.

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

# Local development
bun run dev              # wrangler dev --remote (prod R2/Images remote, code local)
bun run dev:local        # wrangler dev (isolated Miniflare, low-fidelity Images)
# Or from repo root:
bun run dev:files        # same as above, remote bindings
bun run dev:files:local  # same as above, isolated

# Config parity (read-only, never prints secrets)
bun run check:cloudflare   # reports Convex prod/dev parity and dev storage state without printing values
bun run sync:cloudflare-dev # securely writes the dev signing secret to ignored .dev.vars

# Isolated development Worker
bun run deploy:development           # bootstrap, BEFORE the switch: workers.dev only, no route
bun run sync:cloudflare-dev --isolated  # from repo root, AFTER the switch; writes development/.dev.vars
bun run dev:development              # AFTER the switch; local code, remote development bucket/AI/Images
```

`deploy:development` is a plain `wrangler deploy --config
development/wrangler.jsonc` with no Convex check: the Worker must exist and be
verified before Convex dev can switch to it. The committed config can only
bind the development bucket, its own Durable Object namespace and workers.dev,
with no route (tests in `src/deployment.test.ts` and
`scripts/files-worker-dev-boundary.test.ts` enforce that). It sets no secret.
Its `FILES_SIGNING_SECRET` is put separately and proven by a signed
`capabilities` request before the switch, and by `check:cloudflare` (distinct
from production) after it. Only the sync and `dev:development` refuse until
Convex dev uses the isolated Worker.

## Secrets and local vars

- `FILES_SIGNING_SECRET` — must match its corresponding Convex deployment.
  Set production with `bunx wrangler secret put FILES_SIGNING_SECRET`.
- `SENTRY_DSN` — DSN for error reporting (`@sentry/cloudflare`, errors only).
  Reporting stays disabled until this is set. Set with:
  `bunx wrangler secret put SENTRY_DSN`

- `apps/files-worker/.dev.vars` (ignored) — per-developer local overrides for
  `wrangler dev`. Example: `FILES_SIGNING_SECRET=...`. Do not commit. The
  canonical dev routing (`R2_BUCKET`, `R2_KEY_PREFIX`, `FILES_BASE`) lives in
  Convex env, not `.dev.vars`.
  Production-data warning: until isolation is active, dev writes share the
  prod bucket (`teak-files-prod`) and are isolated only by `dev/` prefix;
  credentials retain bucket-wide authority.
- `apps/files-worker/development/.dev.vars` (ignored) — the isolated
  development Worker's local key. `sync:cloudflare-dev --isolated` and
  `dev:development` refuse to run until Convex dev uses the isolated Worker,
  bucket and its own signing key. Keep the older `.dev.vars` for recovery.

Handled op failures (the 500 path) are reported explicitly with op/route,
HTTP method + path, and card/role identifiers parsed from the object key
(`src/sentry.ts`); anything that escapes the handler uncaught is captured
automatically. `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` are optional vars.

## Rollback

The Convex deployment requires both `FILES_BASE` and
`FILES_SIGNING_SECRET` for operations. Downloads can still use the existing
presigned-R2 fallback when the custom file domain is disabled.

Deploys automatically via Cloudflare Workers Builds (main branch).

**Retired:** the pre-convergence `files-dev` Worker and
`files-dev.teakvault.com` domain were deleted after the legacy dev
references reached zero and the dual-read branch was removed. The
`teak-files-dev` bucket (≃1 000 objects / 370 MB of dev-only data) is
draining via a lifecycle expiration rule and will be deleted once empty.
There is no rollback path to the legacy bucket; never reuse `teak-files-dev`.

## Development storage isolation

`bun run check:cloudflare` accepts two dev states: the current shared routing
(`teak-files-prod`, `https://files.teakvault.com`, production signing key and
S3 credentials) and the isolated target (`teak-files-development-20261006`,
`https://teak-files-development.praveenjuge.workers.dev`, its own key and
bucket-scoped credentials). Both keep `R2_KEY_PREFIX=dev/` and exact object
keys. Any mix of the two blocks, and isolated dev must never reuse a production
credential.

These source changes activate nothing. The switch is a separate, approved
operation: deploy and verify the development Worker, copy referenced objects
byte-for-byte, then change the Convex dev variables together. Old dev
credentials keep working on the production Worker until they expire (15 minutes
for single uploads and operations, 1 hour for multipart parts, 24 hours for
import parts), and an admitted request can outlive its expiry, so a timer alone
does not prove quiescence. After the switch, freeze every old `dev/` key through the
production Worker's `freeze-object` operation. `frozen: false` means a write
is still active or ended ambiguously; the key stays in the drain list until it
freezes. Copy the final delta only after every key is frozen.

Freezing is irreversible: frozen keys stay unreadable and unwritable through
the production Worker. Restoring the old dev routing after a freeze is
therefore not a rollback; it would point dev at objects it can no longer read.
Rollback by restoring the backed-up old dev values exists only before the first
freeze. After it, recovery is forward on the isolated Worker: its copies are
the readable data. The old `teak-files-prod` `dev/` objects stay
byte-preserved as the recovery source, readable only through the S3 API, for
re-copying missing or damaged objects into the development bucket with SHA
verification.

Builds for the dev deployment (`reminiscent-kangaroo-59`) allow exactly this
origin: the web CSP, the packaged desktop CSP and shared media recovery. No
`NEXT_PUBLIC_FILES_BASE` is needed for it. Production builds never allow it. If
the deployed workers.dev origin differs, change `DEVELOPMENT_FILES_ORIGIN` and
its client copies together (a drift test checks them).

## Local development experience

- `bun run dev` at repo root starts the default stack (web + Convex) via
  Turborepo. `bun run dev:all` starts every surface (web, convex, desktop,
  raycast, docs, extension).
- `bun run dev:files` — local Worker with remote Cloudflare R2/Images/AI
  bindings (code local, bucket remote). Use for real image transforms and
  prod-data dev isolation (`dev/users/...`). After the storage switch, use
  `bun run --cwd apps/files-worker dev:development` instead.
- `bun run dev:files:local` — isolated Miniflare storage with low-fidelity
  Images emulation; no remote credentials needed.
- `bun run check:cloudflare` — read-only names/parity check without exposing
  secret values.
