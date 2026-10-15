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
worker. Text, link and image metadata calls go through the AI Gateway named by
the `AI_GATEWAY_ID` var (`src/aiGateway.ts`) for request, token, cost and error
analytics. Whisper transcription calls Workers AI directly, because it streams
the audio and AI Gateway does not accept streamed bodies. Calls set
`collectLog: false`, so prompts and replies, which hold card content, are never
stored, and `skipCache: true`, because refreshing a card resends the same prompt
and must get a fresh answer. The gateway must exist before a deploy that names
it. Eligible sources (≤20 MB) are transformed directly from R2 through
the binding, cached per source ETag + rendition + format; larger sources keep
the URL-based transformation path. The Convex backend remains the control plane — it authenticates
users, owns card state, validates uploads, and orchestrates workflows —
while stored-file processing and storage transfers flow through this worker.
Remote preview images and media download on the link fetcher Container (see below).
Link screenshots and browser scrapes run on Browser Run (`BROWSER`); video,
audio and PDF work runs in the media renderer Container (`MEDIA_RENDERER`; see
"Rendering and media" and "Media renderer Container").

## Public API and MCP proxy

`teakvault.com/api`, `/mcp` and the OAuth discovery documents
(`/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`
and `/.well-known/teak-oauth-clients.json`) reach Convex through this Worker
(`src/apiProxy.ts`). Zone routes in `wrangler.jsonc` catch those paths on
`teakvault.com`, which Cloudflare already proxies, and the rest of the site
stays on its own origin. The proxy forwards each request to the same Convex
HTTP path the docs site's Vercel rewrites used (`/api` → `/v1`,
`/api/<path>` → `/<path>`, MCP and discovery paths unchanged), streams request
and response bodies, does not follow redirects, and adds the site's security
headers. `API_PUBLIC_HOST` and `API_UPSTREAM_ORIGIN` configure it; unset, the
Worker proxies nothing, and the development Worker sets neither.

- Bodies whose `Content-Length` is over Convex's 20 MB HTTP action limit get
  413 `CONTENT_TOO_LARGE` without reaching Convex; an unreachable Convex is
  502 `SERVICE_UNAVAILABLE`, in the API's `{ code, error }` shape.
- The OpenAPI spec and the three discovery documents are identical for every
  caller, so the edge cache answers unauthenticated `GET`s for five minutes.
  Clients still see Convex's `Cache-Control: no-store`.
- Paths the route patterns catch only by prefix (`/apis`) fall through to the
  site's origin.
- This Worker is the only way these paths reach Convex: the docs site's Vercel
  rewrites are gone, so without the zone routes they would get the site's 404.
  `src/apiProxy.test.ts` checks that every path the rewrites used to serve
  still reaches the same Convex URL through a route here.
- Errors the Worker answers itself carry the API's CORS headers, an
  `X-Request-Id` and `no-store`, like Convex's own API errors.

### WAF rules

`waf/rules.ts` holds WAF custom rules for the `teakvault.com` zone; they run
before this Worker, so a request they block never invokes it. Today there is
one: `teakvault.com/api` and `/mcp` requests whose declared `Content-Length`
exceeds `API_PROXY_MAX_BODY_BYTES` are blocked. They get Cloudflare's 403
page, not the proxy's 413 JSON: a custom block response needs a plan this zone
is not on, and it could not carry the API's CORS headers anyway, so a
cross-origin browser sees a network error. The exact body size field needs an
Enterprise plan, so the rule compares the header's digits, leaving zero-padded
lengths to the Worker. Chunked bodies without the header still reach the
Worker's and Convex's own limits.

`bun run waf` (`scripts/cloudflare-waf.ts`) shows what would change, `--check`
exits 1 when the zone has drifted, and `--apply` makes the changes through the
Rulesets API. It only creates, updates and deletes rules whose `ref` starts
with `teak-api-`; other custom rules in the zone are never touched. It needs
`CLOUDFLARE_API_TOKEN` with Zone: Read and Zone WAF: Edit on the zone (Zone
WAF: Read for a dry run or `--check`).

### Edge identity

`src/edgeIdentity.ts` resolves each API and MCP request to one rate-limit
bucket, so limits follow the user across their API keys and OAuth apps:
`user:<teakUserId>` for a known Teak API key or a WorkOS access token that
verifies at the edge (`verifyWorkosConnectToken` from `@teak/convex`, against
`API_WORKOS_ISSUER` and the `/api` or `/mcp` audience on `API_PUBLIC_HOST`);
`workos:<id>` for a verified token Convex cannot map or cannot be reached
about; and `ip:<address>` for everything else, so made-up credentials never
choose their own bucket. It is identity for limiting only: Convex still
authenticates every request.

Convex answers at `POST /edge/v1/identity` (`packages/convex/edgeIdentity.ts`),
a read-only lookup signed with the shared files signing secret over its own
`edge-identity` payload (`@teak/files-protocol`). The Worker sends a key's
SHA-256 digest, never the key; Convex knows a key by the digest its validation
caches in `apiKeyAuthCache`. Answers are cached in the `EDGE_IDENTITY` KV
namespace for five minutes, or a minute for an unknown credential, so a new
key is recognized within a minute and a revoked one stops counting against its
owner's edge limit within five. A failed lookup, or a failed KV read, is not
cached.

### Edge rate limits

`src/edgeRateLimit.ts` charges every proxied request (not preflights) to its
bucket before it reaches Convex:

- `API_REQUEST_LIMITER`, 120 a minute, for a known user, and for a request
  with no credential (by address);
- `UNKNOWN_CREDENTIAL_LIMITER`, 60 a minute, for a credential the edge cannot
  tie to a user (by address).

The limits match Convex's `publicApiRequests` and `invalidApiAuth` (a test
checks), and are counted per Cloudflare location in fixed windows, so they
are approximate. Over a limit, `/api` gets the public API's 429
(`RATE_LIMITED`, `Retry-After`, `RateLimit-*`) and `/mcp` gets HTTP 429 with
`Retry-After` and a JSON-RPC error (code `-31429`, the request's `id`): MCP
2026-07-28 defines no rate-limit error and leaves intermediaries an HTTP
status, and reserves -32000 to -32099.

A known user's request within the limit is forwarded with
`x-teak-edge-rate-limit`: an expiry and an HMAC (files signing secret) over
the SHA-256 of its `Authorization` value. Convex
(`hasEdgeRateLimitAttestation` in `packages/convex/edgeIdentity.ts`) then
skips the `publicApiRequests` charge and its database write; MCP tool calls
forward the header with the same `Authorization`. Everything else is charged
by Convex as before: requests without the attestation (including any that
reach `convex.site` directly), JSON-RPC batches, which Convex charges per
call, and requests sent while a limiter is unavailable. A client's own
`x-teak-edge-rate-limit` header is always dropped. Card creation, reprocess
and API key creation limits stay in Convex: they count cards rather than
requests, defer edits rather than refusing them, or never pass the edge.


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
  The `pdf` mode runs `pdftotext` in the media renderer on PDFs up to the
  caller's `maxBytes` (≤100 MiB), reads at most the first 50 pages, and
  returns at most 512 KiB characters of text; oversized, corrupt, and
  password-protected PDFs return empty text, and an unavailable renderer
  answers RENDERER_UNAVAILABLE so Convex retries. Convex treats an older
  Worker's INVALID_INPUT for `pdf` as "no text" rather than failing card
  processing.
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
  used to check an import's source before reading it.
- `list-objects` pages objects under a `users/` (prod) or `dev/users/`
  (dev) prefix (limit ≤1000, opaque cursor) — used by the stale
  pending-upload sweep and the weekly orphaned-object reconciliation report.
  The production Worker accepts both prefixes so dev traffic can share the
  prod bucket.
- `generate-image-metadata` feeds the existing `detail` rendition into
  Workers AI (Gemma multimodal) with the same system prompt, JSON output
  shape, and bounded validation retries as the pipeline it replaced; image
  bytes never leave the worker (`src/imageMetadata.ts`).

## Rendering and media

Rendering never falls back to another renderer. Each op answers:

- `RENDERER_UNAVAILABLE` (503, retryable) when Browser Run or the media
  renderer is missing, busy or failing. Convex retries with backoff, then
  records the stage as failed in `processingStatus`.
- `UNSUPPORTED` (415) only for sources that cannot be rendered: undecodable,
  encrypted, or past the renderer's wall clock.
- `PAYLOAD_TOO_LARGE` (413) for sources over 100 MiB, Teak's upload cap.

The ops:

- `capture-screenshot` and `scrape-html` take HTML that Convex already fetched
  through its DNS-pinned SSRF guard, gzip-compressed and base64-encoded
  (`htmlGzipBase64`, ≤2 MiB inflated) so 2 MiB pages fit the 1 MiB op body.
  Pages run offline on Browser Run: request interception aborts every request,
  and WebSocket, EventSource and `sendBeacon` are disabled before the HTML
  loads. The screenshot is a 1280×720 JPEG; a scrape returns attributes, text
  and inner HTML per selector (≤128 selectors, ≤100 elements each).
- `render-pdf-thumbnail` renders page 1 of a PDF with `pdftoppm` and writes a
  PNG (≤1600px each way) to `destinationKey`.
- `extract-video-frame` writes one JPEG frame (10% in, clamped to 1–5s, or 0s
  under 2s; ≤1600px, rotation applied) for any format ffmpeg decodes: MP4,
  MOV, WebM, MKV, AVI and more, with H.264, HEVC, VP9 or AV1. With the
  optional `scrubDestinationKey` it also writes a hover scrub sprite: 10
  evenly spaced keyframes (≤360px each) side by side in one JPEG, best effort.
  The result carries the media facts, so Convex needs no separate probe.
- `probe-media` returns ffprobe facts: container, duration, display size
  (rotation-aware), video and audio codecs.
- `process-audio` decodes audio once for its facts, two waveforms (45 and 200
  bars, 0–100) and, with `transcribe`, a Whisper transcript. Audio that is not
  MP3 or PCM is converted to a 16 kHz mono MP3 for Whisper in the same pass;
  when Whisper cannot decode the original (error 3030), the Worker converts it
  and retries once. An undecodable recording or a failed transcription comes
  back as a failed `transcript`, so the waveform is still stored.
  `transcribe-audio` stays for Convex deployments that predate it.
- `capabilities` reports `browser` and `renderer`; with `checkRenderer: true`
  it also starts a renderer and reports `rendererHealthy` and
  `rendererProtocol` (used by `scripts/check-files-readiness.ts`).
- `analyze-image` also returns EXIF camera facts (make, model, exposure,
  focal length, ISO, capture time) from JPEG APP1 or the HEIF `Exif` item,
  stored as `fileMetadata.exif`. GPS position is deliberately not read.

The Worker targets Workers Paid. `wrangler.jsonc` raises `cpu_ms` to 5 minutes
and `subrequests` to 20,000 so an export of up to 10,000 files (5 GB) fits in
one request; Workers Free allows 10 ms of CPU and 1,000 R2 calls per request.

Browser Run is shared across operations (`src/browserSessions.ts`): each one
joins a running browser when there is one and launches a browser that stays up
for 60 seconds otherwise, then works in its own browser context and
disconnects. Joining a running browser does not count against Browser Run's
launch rate or concurrency limits, so a link's scrape and screenshot, or a
batch of imports, usually share one browser. Sessions are per account, so the
development and production Workers can share a browser; the private contexts
and offline pages keep their work apart. A refused launch answers
`RENDERER_UNAVAILABLE` (`browser_unavailable`) and Convex retries later.
Workers Paid includes 10 browser hours a month, then bills per hour; Workers
Free allows 10 minutes a day and one new browser every 20 seconds. Browser
Run's local mode runs a real Chrome under `wrangler dev`, and the tests in
`src/rendering.test.ts` drive a local Chrome through the same
`@cloudflare/puppeteer` client (set `CHROME_PATH` on macOS).

## Media renderer Container

`container/` is a Bun server compiled into one static binary
(`bun build --compile`) on Alpine with ffmpeg and poppler-utils; its header
comment in `container/src/server.ts` is the HTTP contract. The Worker reaches
it through the `MediaRenderer` Durable Object (`src/mediaRenderer.ts`), which
starts the Container with `enableInternet: false`, waits for `/health`, and
forwards jobs. `src/rendererClient.ts` picks a random instance from
`renderer-0` to `renderer-<MEDIA_RENDERER_INSTANCES - 1>`, moves to the next
on `busy`, and checks the manifest and every output (JPEG, PNG and MP3
signatures, size caps) before anything is stored. The Container has no R2
access: the Worker streams the R2 body in with a `FixedLengthStream` and
stores every output.

- **Security.** No internet and no outbound handlers. ffmpeg and ffprobe
  always run with `-protocol_whitelist file,pipe`, a demuxer allow-list (no
  HLS, concat, image sequences or lavfi), `-threads 1` and `-max_alloc`, on a
  spooled local file only. Frames over 8192×8192 or 40 MP are refused before
  decoding. Each process runs under `prlimit` (1 GiB address space, a CPU
  budget) as uid 10001, and the whole process group is killed at the job's
  wall clock.
- **Limits.** One job per instance; a second request gets 503 `busy`. Sources
  are spooled with a hard 100 MiB cap (413). Wall clocks: probe 15 s, video
  60 s, audio 120 s, PDF 30 s (422 `timeout`). Undecodable, encrypted or
  hostile input is 415, never 500.
- **Pool.** `instance_type: "basic"` (1/4 vCPU, 1 GiB), `max_instances` 4 in
  production and 2 in development, matched by `MEDIA_RENDERER_INSTANCES`.
  Instances stop after 90 seconds without a request.
- **Deploying.** `wrangler deploy` builds `container/Dockerfile` for
  linux/amd64, so Docker must be available where it runs (Workers Builds
  provides it). The image rolls out after the Worker;
  `check-files-readiness.ts --wait` holds the Convex deploy until a renderer
  answers `/health` with the current protocol.
- **Tests.** `bun test container/src` covers the argument builders (the
  hardening flags are always present), peaks and the manifest. The CI
  `renderer` job builds the image, runs it with `--cpus 0.25 --memory 1g`, and
  runs `container/test` against it with generated fixtures
  (`container/test/fixtures/generate.sh`). Locally, run the server with Bun
  (`PORT=18080 WORK_DIR=$(mktemp -d) bun container/src/server.ts`, needs
  ffmpeg and poppler) and set `RENDERER_URL=http://localhost:18080`.

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

### Remote preview assets: the link fetcher Container

`store-remote-asset` downloads a link preview's image, and the images, videos
and posters of social posts, and stores them in R2, so their bytes no longer
pass through Convex. Convex names the URL, the kind (`image` or `video`) and the
destination key; the Worker forwards the download to the link fetcher
Container (`LINK_FETCHER`, `src/remoteAsset.ts`) and writes what comes back.

The fetcher (`fetcher/`) is the only Container with internet access. It runs
Node, because the policy depends on a pinned connection that the Workers
runtime cannot make: the [Workers HTTP API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
implements neither `lookup` nor `createConnection`, `resolveOverride` only
reaches hosts in the zone, and Undici's Agent fails in workerd
(`ERR_OPTION_NOT_IMPLEMENTED` for `ALPNProtocols`). Inside the Container the
same code Convex used runs unchanged, bundled by path rather than copied:

- `packages/convex/linkMetadata/ssrf.ts`: http(s) only, standard ports, no
  credentials, every resolved address public, every redirect hop rechecked;
- `packages/convex/workflows/steps/pinnedFetch.ts`: the connection goes to the
  addresses that were checked, so DNS rebinding between the check and the
  connection cannot redirect it;
- `packages/convex/workflows/steps/linkMetadata/remoteImageDimensions.ts`:
  images must have readable dimensions within the pixel cap.

Limits come from `@teak/files-protocol` (`FILES_REMOTE_ASSET_MAX_BYTES`: 20 MiB
images, 50 MiB videos). Each instance runs four downloads at once and answers
503 `busy` beyond that; the Worker tries the next instance. A skipped asset
(blocked, HTTP error, wrong type, too large, unreadable image, network failure)
leaves the preview without it, as before. The image builds from the
repository root (`image_build_context`) so it can bundle those files;
`fetcher/Dockerfile.dockerignore` sends only them and the fetcher's own
`package.json` and `bun.lock`.

### Link pages: `fetch-link-page`

`fetch-link-page` fetches a saved link's page through the same Container
(`POST /fetch-page`, `fetcher/src/fetchPage.ts`) and returns its preview
metadata. Convex names the URL and the scrape selectors; the Container fetches
the page with Convex's policy, the browser user agent and a 2 MiB limit,
decodes it, and matches the selectors with Convex's own parser
(`packages/convex/linkMetadata/staticHtml.ts`, also bundled by path), so the
selector results are the ones Convex computed itself. Unlike Convex, it
decodes the page with the charset the page declares (a byte order mark, then
the `Content-Type` charset, then a `<meta>` charset in the first 1024 bytes,
else UTF-8), so non-UTF-8 sites no longer get garbled titles.

When the static HTML matches nothing, as on pages that build their tags in
script, the Worker renders the same HTML offline on Browser Run
(`src/linkPage.ts`), as Convex did with a second `scrape-html` call; a failed
or unavailable browser keeps the static result. The result carries the
selectors, the page's URL after redirects, the charset, which pass produced
them (`static` or `browser`), and the decoded page as gzipped UTF-8 for
parsers that need the whole page (Instagram media). A page the Container
refuses comes back as a result, not an error: `blocked_url`, `http_error`
(with its status), `unsupported_type` (with the type), `too_large` or
`fetch_failed`.

Convex does not call `fetch-link-page` yet; until it does, it still fetches
page HTML itself with the same pinned policy.

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

## Export archive lifecycle

Export archives, their `.checkpoint.json` and `.result.json` sidecars and the
transient `.manifest.json` live under the top-level `exports/<userHash>/`
prefix (`dev/exports/` for development), not under `users/`. Convex still
deletes a ready export when it expires after 7 days (`cleanupExpiredExports`)
and with the account, but an R2 lifecycle rule is the backstop for anything
that path misses: artifacts of failed or canceled jobs, manifests whose
best-effort delete failed, and deletes that errored. Download links are already
refused after expiry, so the extra day costs nothing.

The rules are bucket configuration, not part of `wrangler.jsonc`; add them
once per bucket and confirm with `lifecycle list`:

```bash
bunx wrangler r2 bucket lifecycle add teak-files-prod expire-exports exports/ --expire-days 8
bunx wrangler r2 bucket lifecycle add teak-files-prod expire-dev-exports dev/exports/ --expire-days 8
bunx wrangler r2 bucket lifecycle list teak-files-prod
```

The isolated development bucket needs the `dev/exports/` rule too. Exports
written before the move keep their `users/<hash>/exports/` keys; the daily
cleanup still deletes them, and both roots stay inside the storage namespace
(`isR2KeyInNamespace` in Convex, `isValidUploadKey` here) so account deletion
reaches either.

## Single-file signed uploads

`PUT /__upload/v1/<key>?exp&sig&ct[&sz]` accepts small user uploads,
Convex-validated remote assets, and export manifests. The HMAC binds the HTTP method, exact
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
bun test            # unit + handler tests (fixtures in src/fixtures), plus container/src
bun run cf-typegen  # refresh generated Worker bindings/runtime types
bun run typecheck   # tsc --noEmit for the Worker and the Container
bunx wrangler deploy --dry-run --outdir /tmp/out   # bundle size check; builds the
                    # renderer image, so it needs Docker (add
                    # --containers-rollout=none to check the Worker alone)
bun run deploy      # wrangler deploy (creates files.teakvault.com custom domain)

# Local development
bun run dev              # wrangler dev --remote (prod R2/Images remote, code local)
bun run dev:local        # wrangler dev (isolated Miniflare, low-fidelity Images)
# Or from repo root:
bun run dev files        # same as above, remote bindings
bun run dev files:local  # same as above, isolated

# Config parity (read-only, never prints secrets)
bun run check:cloudflare   # reports Convex prod/dev parity and dev storage state without printing values
bun run sync:cloudflare-dev # securely writes the dev signing secret to ignored .dev.vars

# Isolated development Worker
bun run deploy:development           # bootstrap, BEFORE the switch: workers.dev only, no route
bun run sync:cloudflare-dev --isolated  # from repo root, AFTER the switch; writes development/.dev.vars
bun run dev:development              # AFTER the switch; local code, remote development bucket/AI/Images
```

`wrangler dev` builds and runs the renderer Container locally, which needs a
running Docker daemon. To work on other parts of the Worker without Docker,
set `"dev": { "enable_containers": false }` in your local copy of the config;
media jobs then answer `RENDERER_UNAVAILABLE`.

`deploy:development` is a plain `wrangler deploy --config
development/wrangler.jsonc` with no Convex check: the Worker must exist and be
verified before Convex dev can switch to it. The committed config can only
bind the development bucket, its own Durable Object namespaces (deletion gates
and the media renderer) and workers.dev,
with no route (tests in `src/deployment.test.ts` and
`scripts/files-worker-dev-boundary.test.ts` enforce that). It sets no secret.
Its `FILES_SIGNING_SECRET` is put separately and proven by a signed
`capabilities` request before the switch, and by `check:cloudflare` (distinct
from production) after it. Only the sync and `dev:development` refuse until
Convex dev uses the isolated Worker.

## Secrets and local vars

- `FILES_SIGNING_SECRET` — must match its corresponding Convex deployment.
  Set production with `bunx wrangler secret put FILES_SIGNING_SECRET`.
- `POSTHOG_PROJECT_TOKEN` — public PostHog project token for error reports
  (errors only, sent with a plain `fetch`). A plain var in the production
  `wrangler.jsonc`; the development Worker has none, so it reports nothing.

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
(`src/telemetry.ts`); anything that escapes the handler uncaught is reported
by the wrapper in `src/index.ts`. Reports are sent after the response with
`waitUntil`.

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
(`teak-files-prod`, `https://files.teakvault.com`, production signing key)
and the isolated target (`teak-files-development-20261006`,
`https://teak-files-development.praveenjuge.workers.dev`, its own key).
Convex holds no S3 credentials. Both keep `R2_KEY_PREFIX=dev/` and exact object
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
origin: the web CSP and shared media recovery. No
`NEXT_PUBLIC_FILES_BASE` is needed for it. Production builds never allow it. If
the deployed workers.dev origin differs, change `DEVELOPMENT_FILES_ORIGIN` and
its client copies together (a drift test checks them).

## Local development experience

- `bun run dev` at repo root starts the default stack (web + Convex) via
  Turborepo. `bun run dev --all` starts every surface (web, convex, raycast,
  docs, extension).
- `bun run dev files` — local Worker with remote Cloudflare R2/Images/AI
  bindings (code local, bucket remote). Use for real image transforms and
  prod-data dev isolation (`dev/users/...`). After the storage switch, use
  `bun run --cwd apps/files-worker dev:development` instead.
- `bun run dev files:local` — isolated Miniflare storage with low-fidelity
  Images emulation; no remote credentials needed.
- `bun run check:cloudflare` — read-only names/parity check without exposing
  secret values.
