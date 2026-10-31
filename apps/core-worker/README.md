# @teak/core-worker

The Cloudflare Worker for Teak file delivery, uploads, card processing,
imports, exports, background work and the API edge proxy. Production is the
`core-worker` Worker (`wrangler.jsonc`; renamed from `teak-files-proxy` to
`teak-files-prod` on 19 Oct 2026, then to `core-worker`; its container apps
keep the `teak-files-proxy-*` names). It serves `files.teakvault.com` from the
`teak-files-prod` bucket, for the production Convex deployment only. The
pre-convergence `files-dev` Worker/domain and the old `teak-files-dev` R2
bucket are gone.

Development runs this same source as the `core-worker-dev` workers.dev
Worker (`development/wrangler.jsonc`; renamed from `teak-files-dev`, and its
container apps keep the `teak-files-dev-*` names) on the private
`teak-files-development-20261006` bucket and `teak-dev-cards-0` vector index,
with its own Durable Object namespaces, queues, workflows and secrets. Convex
dev points at it; see "Development storage isolation".

The Convex backend mints long-lived HMAC-signed URLs
(`packages/convex/storage/r2.ts` → `buildSignedWorkerFileUrl`). This worker
verifies the token, reads the object through an R2 binding, and streams it
with `FILES_PRIVATE_CACHE_CONTROL` from `@teak/files-protocol` (6 days, a day
less than a signed URL stays valid). It also handles single
HTTP `Range` requests (206 responses) so video/audio seeking works, serves
full-object responses from the Cloudflare edge cache keyed by object path +
content-disposition policy, answers conditional GETs with 304s, and supports
`HEAD`. The edge copy outlives a deleted or replaced object while a signed
link is still valid, so a cache hit first `head`s the object (one class B
read, no body): a deleted object answers 404 and drops the edge copy, and a
replaced one is read and cached again. Hits still skip streaming the body
from R2. The bucket is never public. `/__health` is an unauthenticated
liveness probe for uptime monitors.

The worker also owns the Images (`IMAGES`) and Workers AI (`AI`) bindings:
only unique transformed variants (`tiny`, `compact`, `grid`, `detail`) consume
Image Transformations, and image understanding runs on Workers AI inside the
worker. Text, link and image metadata calls go through the AI Gateway named by
the `AI_GATEWAY_ID` var (`src/ai/aiGateway.ts`) for request, token, cost and error
analytics. Whisper transcription calls Workers AI directly, because it streams
the audio and AI Gateway does not accept streamed bodies. Calls set
`collectLog: false`, so prompts and replies, which hold card content, are never
stored, and `skipCache: true`, because refreshing a card resends the same prompt
and must get a fresh answer. The gateway must exist before a deploy that names
it. Eligible sources (≤20 MB) are transformed directly from R2 through
the binding, cached per source ETag + rendition + format; larger sources keep
the URL-based transformation path. The Convex backend remains the control plane — it authenticates
users, owns card state and validates uploads — while background work
(Cloudflare Workflows, Queues and Cron Triggers; see "Background work"),
stored-file processing and storage transfers run in this worker.
Remote preview images and media download on the link fetcher Container (see below).
Link screenshots and browser scrapes run on Browser Run (`BROWSER`); video,
audio and PDF work runs in the media renderer Container (`MEDIA_RENDERER`; see
"Rendering and media" and "Media renderer Container").

To run a Core Worker of your own, follow the public self-hosting guide
(`apps/docs/content/docs/(open-source)/self-hosting.mdx`, "Core Worker"):
the resources to create, the vars to change and the secrets to put. This file
covers how Teak's own Workers behave and are operated.

## Source layout

`src/index.ts` is the entry: file delivery, signed uploads and the routes below. The root of `src/` keeps only it and the plumbing every area shares (`ops.ts`, the internal ops router; `lib.ts`; `telemetry.ts`; `convexRpc.ts`; `opFailure.ts`; `deletionGate.ts`). Everything else sits in the folder for its area, and a module's tests sit next to it as `*.test.ts`:

| Folder | What goes there |
| --- | --- |
| `edge/` | The public API and MCP proxy, edge identity and edge rate limits ("Public API and MCP proxy"). |
| `ai/` | Workers AI calls and their accounting: the AI gate and Gateway, usage and pricing, decisions, text metadata, transcripts and Vectorize embeddings. |
| `images/` | Image transforms, analysis, EXIF, palettes, the Images binding and the WASM decoders. |
| `media/` | Browser Run, the media renderer and link fetcher Containers, link pages, linked PDFs, PDF OCR and remote assets ("Rendering and media"). |
| `archives/` | ZIP reading, file inspection, export archives and import sources. |
| `storage/` | Signed uploads, R2 retries, multipart cleanup and onboarding files. |
| `scheduled/` | Cron Triggers: the cron router, hourly cleanup and workflow reconciliation. |
| `workflows/`, `queues/` | Cloudflare Workflows (card processing, imports, exports, account deletion) and queue consumers. |
| `test/`, `fixtures/` | Shared test doubles and binary fixtures. |

## Public API and MCP proxy

`teakvault.com/api`, `/mcp` and the OAuth discovery documents
(`/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`
and `/.well-known/teak-oauth-clients.json`) reach Convex through this Worker
(`src/edge/apiProxy.ts`). Zone routes in `wrangler.jsonc` catch those paths on
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
  Clients see the `Cache-Control` Convex sent: `public, max-age=300` on the
  discovery documents, `no-store` on the OpenAPI spec.
- Paths the route patterns catch only by prefix (`/apis`) fall through to the
  site's origin.
- This Worker is the only way these paths reach Convex: the docs site's Vercel
  rewrites are gone, so without the zone routes they would get the site's 404.
  `src/edge/apiProxy.test.ts` checks that every path the rewrites used to serve
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

`src/edge/edgeIdentity.ts` resolves each API and MCP request to one rate-limit
bucket, so limits follow the user across their API keys and OAuth apps:
`user:<teakUserId>` for a known Teak API key or a WorkOS access token that
verifies at the edge (`verifyWorkosConnectToken` from `@teak/convex`, against
`API_WORKOS_ISSUER` and the `/api` or `/mcp` audience on `API_PUBLIC_HOST`);
`workos:<id>` for a verified token Convex cannot map or cannot be reached
about; and `ip:<address>` for everything else (an IPv6 client by its /64,
`ip:<prefix>::/64`, since one host holds a whole /64), so made-up credentials
never choose their own bucket. It is identity for limiting only: Convex still
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

`src/edge/edgeRateLimit.ts` charges every proxied request (not preflights) to its
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


### MCP at the edge

MCP clients open every session with `initialize`, a
`notifications/initialized`, `tools/list` (and, for clients that render MCP
Apps, `resources/list`), and then `ping` now and then. For a `/mcp` POST the
edge has tied to a Teak user (`user:` identity) and charged to that user's
limit, `src/edge/mcpEdge.ts` answers the notifications, `tools/list`,
`resources/list`, `resources/templates/list` and `ping` itself: if every
message in the body (one, or a batch of up to 100) is one of them, the Worker
replies with the JSON-RPC result, `202` with no body for notifications alone,
and the headers Convex adds (`MCP_CORS_HEADERS`, the API's CORS headers,
`X-Request-Id`, `no-store`). The lists come from
`packages/convex/mcp/protocol.ts`, which Convex's `mcp/httpServer.ts` uses too,
so both answer byte for byte the same; `ping` answers `{}` in both.
`initialize` always goes to Convex, so a key revoked in the last few minutes
fails there, and so does `resources/read`, whose card view carries a sandbox
origin derived from the deployment's public MCP URL. Anything else is forwarded
unchanged: a tool call (alone or in a batch), an unknown method or invalid
message, a body Convex would refuse (wrong `Accept`
or `Content-Type`, unparseable, over 64 KiB, more than 100 messages), and every
request without a known user, so an unknown credential still gets Convex's 401
with `WWW-Authenticate`. The identity cache can trail a revoked key by up to
five minutes; these answers carry nothing about the account, and Convex still
authenticates every tool call.

## Internal ops

Besides downloads, the worker accepts body-bound, short-lived signed `POST`
requests at `/__ops/v1`. Contracts and typed success/error envelopes live in
`@teak/files-protocol`; `HEAD` and `GET` can never execute an operation.
Operation request bodies are limited to 1 MiB before signature verification.

- `op=analyze-image` — reads intrinsic dimensions and a bounded color sample
  through Cloudflare transformations; SVG input is rasterized with resvg.
  Renditions are generated on demand and no image derivative is written to R2.
- `build-export` — streams a manifest-described set of objects through
  client-zip into a checkpointed multipart ZIP upload that resumes after
  transient failures (`src/archives/export.ts`).
- `inspect` — bounded inspection returning facts or AI text without the
  object transiting Convex (`src/archives/inspect.ts`): zip archives are walked via R2
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
  (dev) prefix (limit ≤1000, opaque cursor) — used by the weekly
  orphaned-object reconciliation report. `cleanup-stale-pending-uploads`
  deletes pending uploads older than a day under one of those prefixes, ten
  list pages a call; the weekly cron's backstop sweep runs it in-process.
  The production Worker accepts both prefixes so dev traffic can share the
  prod bucket.
- `generate-image-metadata` feeds the existing `detail` rendition into
  Workers AI (Gemma multimodal) with the same system prompt, JSON output
  shape, and bounded validation retries as the pipeline it replaced; image
  bytes never leave the worker (`src/images/imageMetadata.ts`).
- `generate-text-metadata`, `generate-link-metadata` and
  `generate-image-metadata` write the tags and summary in the content's main
  language (an image's: the language of its text, or English when it has
  none) and answer that `language` as a BCP 47 primary tag, normalized by
  `normalizeAiLanguage` (`packages/files-protocol/src/metadata.ts`); a
  missing or invalid one is dropped, never retried. Card processing saves it
  as `cards.aiLanguage` with the tags and summary, and records it and
  `AI_METADATA_PROMPT_VERSION` in the `generate metadata` step's result.
- `store-onboarding-files` copies a new account's getting-started files into
  R2 at the keys Convex names (at most 32), with the content type Convex gives,
  and answers each object's size (`src/storage/onboardingFiles.ts`). The files ship
  with the Worker as static assets (`assets/onboarding/`, the `ASSETS`
  binding, read with `env.ASSETS.fetch`), so they never pass through Convex
  and do not count toward the script size. A card's files land together or
  not at all: when one is missing or fails, the others are deleted and the
  card answers `stored: false`. `assets.run_worker_first` is `true`, so every
  request still reaches the Worker and no asset has a public path.
  `capabilities` reports `onboardingFiles` when the binding is there, and the
  deploy readiness check requires it.

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
  `capture-screenshot` takes a link's saved copy instead when it has a full
  one (`archiveKey`, read from the bucket, ≤24 MiB): its styles, fonts and
  images are inline, so the offline render looks like the page. A missing
  copy answers `NOT_FOUND` and an oversized one `PAYLOAD_TOO_LARGE`, and the
  card processing workflow then captures the fetched page.
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
  back as a failed `transcript`, so the waveform is still stored. A transcript
  over 512 KiB of UTF-8 also comes back failed.
- `capabilities` reports `browser` and `renderer`; with `checkRenderer: true`
  it also starts a renderer and reports `rendererHealthy` and
  `rendererProtocol` (used by `scripts/check-files-readiness.ts`).
- `analyze-image` also returns EXIF camera facts (make, model, exposure,
  focal length, ISO, capture time) from JPEG APP1 or the HEIF `Exif` item,
  stored as `fileMetadata.exif`. GPS position is deliberately not read.

The Worker targets Workers Paid. `wrangler.jsonc` raises `cpu_ms` to 5 minutes
and `subrequests` to 20,000 so an export of up to 10,000 files (5 GB) fits in
one request; Workers Free allows 10 ms of CPU and 1,000 R2 calls per request.

Browser Run is shared across operations (`src/media/browserSessions.ts`): each one
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
it through the `MediaRenderer` Durable Object (`src/media/mediaRenderer.ts`), which
starts the Container with `enableInternet: false`, waits for `/health`, and
forwards jobs. `src/media/rendererClient.ts` picks a random instance from
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
  ffmpeg and poppler) and set `RENDERER_URL=http://localhost:18080`. In a
  Claude Code cloud session, build the image with
  `scripts/cloud-docker-build.sh` and run the CI job's steps; `wrangler dev`
  builds both Containers there through `scripts/cloud-docker.sh`
  (`.agents/cloud.md`, "Containers").

## Import and audio processing

- `index-import-source` accepts archive/bookmarks/raindrop, expected source size,
  and an offset cursor. It returns at most 100 items and 4 MiB of item JSON;
  continuation requests bind the original ETag. The import Workflow binds
  that ETag to the job before staging items and uses it during extraction.
- `read-import-markdown` returns one UTF-8 Markdown entry (512 KiB maximum),
  or a typed per-item decoding/size failure. The Workflow decides whether a
  legacy document becomes a text card.
- ZIP inspection, indexing, and `extract-import-files` share `src/archives/zip.ts`.
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
- The Workflow writes the error report (bounded excerpts of the failed items)
  under `<user>/imports/<job>/error-report.txt`. Source/report cleanup is
  handed to the durable object-deletion queue before import rows are removed.
  Multipart abort is idempotent only for R2 `NoSuchUpload` (10024); other
  errors propagate.

### Import staging

The import Workflow (`src/workflows/import.ts`) keeps the items it reads in
R2, not in Convex. Each source page is normalized and deduplicated in the
Worker (a URL seen on an earlier page is skipped; earlier pages' URLs travel
in the step results as short hashes), then its importable items are written
as staged parts of about 8 MiB at `<user>/imports/<job>/staged/<n>.json`.
Before writing them, `import/staging:recordPage` adds the page's counts and
its number of parts to `importJobs.stagedItems`, so every cleanup knows the
parts' keys, and `recordFailures` stores the page's failed items as
`importJobItems` rows. Those rows are all Convex keeps: the failure samples
and the report read them. A page whose answer was lost is read again and
writes the same parts; its counts are not added twice.

Cards are created five at a time from the job's position (`part`,
`offset`) with `import/staging:createBatch`, which runs only while the job is
still at the position the batch started from, so a retried batch creates
nothing twice. Archive files are extracted to
`<user>/import-<job>/item-<sourceIndex>/file/<name>` first; a file whose card
is not created is queued for deletion in the same transaction. When the run
finishes, fails or is canceled, it deletes the source, the staged parts and
any file extracted for the batch it stopped at. If the run dies without
finishing, the workflow outbox's failure handler deletes the parts; starting
the next import (`cleanupImportJob`) and account deletion delete them too.

A new run of a job that was indexing (`resume staged index`) rebuilds the
earlier pages' URL hashes from the source and writes the last recorded page's
parts again. Jobs queued before `stagedItems` existed still stage rows
through the old functions until they finish (`.agents/sunset.md`).

### Remote preview assets: the link fetcher Container

`store-remote-asset` downloads a link preview's image, and the images, videos
and posters of social posts, and stores them in R2, so their bytes no longer
pass through Convex. Convex names the URL, the kind (`image` or `video`) and the
destination key; the Worker forwards the download to the link fetcher
Container (`LINK_FETCHER`, `src/media/remoteAsset.ts`) and writes what comes back.

The fetcher (`fetcher/`) is the only Container with internet access. It is a
Bun binary (compiled like the renderer), not a Worker, because the policy
depends on a pinned connection that the Workers runtime cannot make: the
[Workers HTTP API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
implements neither `lookup` nor `createConnection`, and `resolveOverride` only
reaches hosts in the zone. Inside the Container the SSRF guard Convex used
runs unchanged, bundled by path rather than copied:

- `packages/convex/linkMetadata/ssrf.ts`: http(s) only, standard ports, no
  credentials, every resolved address public, every redirect hop rechecked;
- `fetcher/src/pinnedFetch.ts`: the connection goes to the addresses that
  were checked, so DNS rebinding between the check and the connection cannot
  redirect it. Bun's `fetch` (1.4.3 and later) is given the checked address in
  the URL and the original host in `Host` and `tls.serverName`, so it sends
  SNI for that host and verifies the certificate against it, and never
  resolves the name itself. It ignores the proxy environment and
  `NODE_TLS_REJECT_UNAUTHORIZED`, opens a new connection per request, and
  tries the next checked address when a GET or HEAD fails before a response;
- `fetcher/src/remoteImageDimensions.ts`: images must have readable
  dimensions within the pixel cap.

Card processing (`src/workflows/cardProcessing/`) runs the same `safeFetch`
in the Worker for the requests it makes to user URLs (Bluesky, Mastodon,
Reddit and TikTok post APIs): it resolves each hop's host with DNS over HTTPS
(`src/media/pinnedHop.ts`) and sends one hop at a time to `POST /hop`
(`fetcher/src/hop.ts`), which checks the addresses again with the same policy,
connects only to them, and returns a redirect unfollowed, so the Worker checks
its target before the next hop. A hop carries only `accept` and `user-agent`
and brings back at most its byte cap plus one.

Podcast episode audio (`podcastAudio.ts`) is larger than a hop holds, so it
goes to `POST /hop-stream` (`createContainerStreamingFetch`): the same checks,
with the body streamed back as it arrives, up to 100 MB and five minutes.
Its temporary object is written through the deletion gate in 8 MiB parts
(the gate already carries 64 MiB upload parts), so account deletion can
fence the key and abort the upload; a fenced key is a `blocked` miss.
Each instance runs one streamed hop at a time, and its slot is held until the
body ends or the Worker hangs up, so page fetches keep the other three.

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
(`src/media/linkPage.ts`), as Convex did with a second `scrape-html` call; a failed
or unavailable browser keeps the static result. The result carries the
selectors, the page's URL after redirects, the charset, which pass produced
them (`static` or `browser`), and the decoded page as gzipped UTF-8 for
parsers that need the whole page (Instagram media). A page the Container
refuses comes back as a result, not an error: `blocked_url`, `http_error`
(with its status), `unsupported_type` (with the type), `too_large` or
`fetch_failed`.

Convex's link metadata step calls `fetch-link-page` whenever a Core Worker is
configured, and the deploy readiness gate requires it. A refusal maps to the
outcome Convex gave the same failure before: `blocked_url` and a definitive
4xx fail the preview, and everything else, including a busy or unavailable
Worker, retries the step. Only a stack without a Core Worker (the local E2E
stack) still fetches the page in Convex, with the same pinned policy and
static HTML only.

Fetched pages are kept for 24 hours in the `LINK_PAGE_CACHE` KV namespace,
keyed by a hash of the URL and the selectors, so a link many people save is
fetched and rendered once a day. Every fetch is anonymous (no cookies or
credentials), so the cached page is what anyone requesting that exact URL
would get. A page whose `Cache-Control` says `no-store` or `private` is never
kept, nor is any refusal, nor a page whose Browser Run render failed (the
next save renders it again); a page from an older fetcher image, which does
not report its `Cache-Control`, is not kept either. A card refresh sends
`fresh`, which skips the kept copy and keeps the page it fetches, so the
refreshed preview, category and screenshot see the page as it is now. A KV
read or write that fails falls back to fetching. Without the binding
(development, tests) nothing is cached.

### Verification and deployment boundary

Deterministic tests cover signed routes, pagination, source replacement, ZIP64
reads beyond 4 GiB, unsafe entries, actual decompression limits, Markdown
outcomes, and binding input/output limits. `packages/convex/edge/importConsolidation.test.ts`
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
read-only capability probe must confirm the required operations, dispatch item
types and AI/Images bindings before Convex deploys. It waits at most ten minutes for Cloudflare Builds.

The first index step retains its original function reference and arguments.
Old journal results have no continuation cursor and follow their existing step
sequence. New imports checkpoint one page per step and deduplicate across
pages in the Worker (see Import staging). Markdown reads run eight at a time. The optional `importJobs.sourceEtag` is bound atomically
inside indexing/extraction, so existing journals can resume without a restart
or backfill. A local backend plus real R2 run indexed 10,000 items (about
55 MiB of JSON, including 256 Markdown files) across 100 pages in 391 seconds.
The longest Markdown-heavy page took 44 seconds; all fixtures were cleaned up. Before rollback, retain this optional schema field while reverting
callers; reverting to a schema that rejects stored ETags requires a separate,
explicitly approved data migration. Keep the compatible worker deployed while
rolling back backend callers.

## Card embeddings (Vectorize)

`CARD_VECTORS_0` binds the `teak-cards-0` Vectorize index (768 dimensions,
cosine, a string metadata index on `type`), which holds card embeddings for
semantic search, one namespace per user. `capabilities` reports `vectors` when it is bound. The model, prompts and
shard layout are in `.agents/semantic-search.md`.

Four signed ops read and write the index (`src/ai/vectors.ts`):

- `embed-upsert` embeds up to 32 card texts with the document prompt and
  upserts them into one namespace, each with its card's `type` as metadata.
  Workers AI capacity errors answer `AI_CAPACITY` (429); a vector of the
  wrong size is never written.
- `vector-delete` deletes up to 1,000 ids.
- `vector-get` reports which of up to 100 ids have a vector, and in which
  namespace.
- `vector-query` embeds a query of up to 500 characters with the query prompt
  and returns the top matches (at most 100) in one namespace, ids and scores
  only. With `type` it returns cards of that type, plus close vectors written
  before vectors carried a type. `capabilities` reports `vectorTypes`.
- `vector-similar` searches with one card's stored vector (no Workers AI call)
  and returns its closest cards in the same namespace, without the card itself.
  A card with no vector in that namespace answers `found: false`, so one user
  can never search with another's card.

Every op names its shard; a shard with no binding is `INVALID_INPUT`. Convex
decides what text, namespace and shard to send.

## Background work

Card processing, exports, imports, account deletion and maintenance run as
Cloudflare Workflows in this Worker (`src/workflows/`, entrypoints in
`src/workflows/entrypoints.ts`). Convex starts them through an outbox:
`packages/convex/workflowDispatch.ts` writes a `workflowDispatches` row in
the same transaction as the change that needs the work, and a flush hands due
rows to the `dispatch` op, which creates the instances (an ID that already
exists counts as started, so a resend is safe) and queues object deletions
on `OBJECT_DELETIONS`. Rows the Worker refuses go back to pending with
backoff; deletions it accepts are done at once.

Backend analytics events from mutations (`card_created`, `user_signed_up`,
`card_processing_failed`, Save by email's events) ride the same outbox as
`analytics-event` items, so a mutation that already starts work adds no
function call. Convex writes them only when it has `POSTHOG_PROJECT_TOKEN`,
and deletes each row as it hands it over: events are best effort, never
retried by Convex. The op answers them ok and, after the response
(`waitUntil`), sends all of one dispatch's events in one PostHog `/batch/`
request with this Worker's `POSTHOG_PROJECT_TOKEN`, exactly as Convex would
(`$lib: teak-backend`, the deployment's `$app_version`, `$set`, the time of
the change). A failed request is tried once more; each event carries a UUID,
so PostHog keeps one copy. `capabilities` lists the item types the op takes in
`dispatchItems`, and the backend readiness check requires `analytics-event`.

Steps read and write Convex through one signed endpoint,
`POST <convex.site>/__workflow/v1` (`src/convexRpc.ts` →
`packages/convex/workflowGateway.ts`), which runs one function from
`packages/convex/workflows/rpcAllowlist.ts` per call. Every card-processing
write carries the run's processing revision and lands only while the card is
still on it, so an edit (which bumps the revision and stops the older run)
can never be overwritten by the run it replaced.

A link's raw scrape and its category's raw provider data (1 KiB to 512 KiB of
JSON) go to R2 from the step, not through Convex
(`src/workflows/cardProcessing/rawMetadata.ts`). The step registers the
card's `raw-<kind>/<SHA-256>.json` key, writes it through the deletion gate,
reads it back and checks its hash, and sends Convex only the reference.
Smaller or non-lossless payloads, and any payload whose archive failed, still
go inline, and Convex archives those itself as before. The rules are in
`.agents/convex-costs.md` ("Raw provider metadata").

Before an AI call (Clef decisions, AI metadata, link image text, podcast
transcripts) a step checks the account's AI gate (`adminAccess:getAiGate`)
through `src/ai/aiGate.ts`, which reuses an answer for up to 60 seconds: first
from a memo in the isolate, then from the Cache API in that data center, and
only then over the RPC endpoint. A card run asks Convex once instead of once
per AI step, and runs for the same account within the minute usually not at
all. So pausing AI from the admin console, or turning it off for one account,
takes up to a minute to reach running work. An unreadable cache falls back to
the RPC; an RPC failure fails the step as before and is never cached.

Each deployment has its own workflow RPC secret: the Worker derives it from
`WORKFLOW_RPC_ROOT_SECRET` and the deployment's origin, and the deployment
holds only the result as `WORKFLOW_RPC_SECRET`. Gateway requests and the
dispatch op's proof are signed with it over a payload that names the
deployment, so development, which shares `FILES_SIGNING_SECRET` with
production, can neither call production's gateway nor start work that
reports to production. Workflows call back the deployment named in their
params, which must be one of `CONVEX_SITE_URLS`.

Most workflow tests run the step code on a fake step runner
(`src/test/fakeStep.ts`). `src/workflows/cardProcessing/engine.test.ts` runs
card processing on Cloudflare's real Workflows engine instead (Wrangler's
`createTestHarness`, about three seconds, no account), against a local server
standing in for the Convex endpoint: retries, a stale write ending the run as
skipped, and every run reporting back. Add a case there when a change depends
on what the engine does, such as retry configs or how a step's error reaches
the workflow (a `NonRetryableError` arrives as a plain `Error` whose message
starts with `NonRetryableError: `). On the local E2E stack, Cloudflare's Local
Explorer shows each run's steps, logs and stored objects
(`.agents/skills/verify-teak/features/card-processing.md`).

## Cron Triggers

`src/scheduled/cron.ts` runs the background tasks that used to be Convex crons; Convex
keeps the table logic in internal functions the Worker calls. The
schedules live in `packages/convex/cronSchedules.ts` (`runsOn: "cloudflare"`)
and must equal `triggers.crons` in both Wrangler configs; a Convex test checks.
This Worker serves every deployment in `CONVEX_SITE_URLS`, so each task runs
once per deployment, and one deployment's failure neither stops another nor
goes unreported (PostHog, with the deployment). Tasks the handler runs itself
record the deployment's cron heartbeat (`adminHealth:recordCronRun` over the
workflow RPC gateway) under the name in `cronSchedules.ts`, so the admin
health view lists them beside Convex's own crons.

| Cron (UTC) | Task |
| --- | --- |
| `0 2 * * *` | Card cleanup: starts the maintenance workflow, which records its own heartbeat. Also yesterday's admin snapshot and the admin overview (`admin-daily-snapshot`, maintenance workflow; see "Admin metrics") |
| `0 3 * * *` | Export cleanup and Save by email receipt pruning (`cleanup-inbound-email-receipts`), each a maintenance workflow |
| `0 4 * * 1` | Orphan sweep (maintenance workflow), and the pending-upload backstop sweep (`sweep-stale-pending-uploads`) |
| `0 */6 * * *` | AI metadata backfill into the `AI_BACKFILL` queue (`ai-metadata-backfill`) |
| `15 * * * *` | AI usage rollup (`ai-usage-rollup`; see below) |
| `45 * * * *` | Workflow reconcile (`reconcile-workflows`) and the hourly cleanups below |

The hourly cleanups (`src/scheduled/hourlyCleanup.ts`) run side by side, each with its
own heartbeat, and page Convex until it has nothing left:

- `cleanup-semantic-search-cache` deletes expired rows from both search
  caches, 500 a call (`search/semanticCache:cleanupExpired`,
  `search/relevanceCache:cleanupExpired`).
- `cleanup-abandoned-import-uploads` takes imports whose upload window passed
  (`dataImport:findExpiredUploads`, 50 a page), aborts each multipart upload
  in R2 in-process, then fails the job and queues its source for deletion
  (`dataImport:expireAbandonedUpload`, which leaves a job that is no longer an
  expired upload alone). A failed abort keeps the job for the next hour and
  fails the run.
- `cleanup-expired-upload-sessions` aborts the multipart upload of each
  expired session still uploading (a failed abort is ignored) and deletes the
  session (`fileUploads:findExpiredSessions`, `fileUploads:deleteSession`).
- `cleanup-expired-idempotency` calls
  `operationalRetention:startIdempotencyCleanup`, which starts the retention
  scan. The scan keeps its lease and continues itself in bursts in Convex
  (`.agents/convex-costs.md`).

The `capabilities` op lists the names of the tasks this Worker runs (`crons`),
and `scripts/check-files-readiness.ts` holds the Convex deploy until it
includes every `runsOn: "cloudflare"` task, so no cleanup stops running in
between. Every cleanup is safe to repeat, so a Convex cron and the Worker
running the same task during a deploy do no harm.

The reconcile (`src/scheduled/workflowReconcile.ts`) asks Convex for runs that have not
reported for longer than their kind allows (`workflowDispatch:listStale`) and
looks each instance up through its binding: `complete` reports complete, and
`errored` or `terminated` reports errored with the instance's error, so the
job behind it fails instead of staying "running". An instance Workflows does
not know (`instance_missing`) means the hand-over was lost after Convex
claimed the row, so the row is sent again (up to the dispatch attempt limit).
Queued, running, waiting and paused runs are left alone, and a lookup that
fails for another reason is tried again the next hour. It then prunes finished dispatch rows
(`workflowDispatch:pruneFinished`, at most ten pages).

## Admin metrics

The admin console's daily snapshot and overview are counted here, so Convex
no longer pages every user and card in an action or a reactive query. One
maintenance workflow task, `admin-snapshot`, counts both from a single scan of
every card over the workflow RPC gateway, at most 400 pages of 500 cards; a
longer scan is stored as approximate. The counting code is shared with Convex
(`packages/convex/admin/stats.ts`).

- It pages `adminMetrics:usersPage`, flags internal accounts
  (`adminAccess:flagAutoInternalAccounts`), then pages `admin:overviewCardsPage`
  once. Each row carries what both counts need.
- It stores `admin:getOverview`'s result with and without onboarding cards in
  `adminOverviews` (`admin:writeOverview`). `getOverview` returns the stored
  row, with `generatedAt` set to when it was counted, so the overview can be
  up to a day old. Before the first count it counts up to 10,000 cards itself,
  as it used to.
- It writes one UTC day's `adminDailyMetrics` row (yesterday from the 02:00
  cron), leaving onboarding cards out. It reads the day's AI usage and asks
  Convex for the billing line (`adminMetrics:readSnapshotBilling`, which calls
  Polar; the Worker holds no Polar token) when the day is yesterday or today.

An admin's "capture snapshot" (`adminMetrics:captureSnapshot`) queues the same
task through the outbox with the day as a param, so the row lands a little
after the action returns. That run refreshes the overview too, and reports to
its dispatch row instead of the cron's heartbeat.

`capabilities` lists the tasks in `maintenanceTasks`, and Backend Deploy waits
for all of them.

## R2 events and pending uploads

A pending upload is an object under `.../cards/upload-pending-v2/` that a client
uploaded but never finalized into a card. The bucket's event notification
sends every object written under `users/` and `dev/users/` to `R2_EVENTS`
(`teak-r2-events`, or `teak-r2-events-dev` for the development bucket).
`src/queues/r2Events.ts` acknowledges everything that is not a pending upload.
A pending upload younger than 24 hours goes back on the queue with a delay of
up to 12 hours (the queue's maximum), carrying its original upload time; once
it is 24 hours old the consumer reads its head and deletes it if it is still
there and was uploaded at least 24 hours ago, the same rule as the
`cleanup-stale-pending-uploads` op. The weekly cron runs that op in-process for
`users/` and `dev/users/` until it reaches the end or five minutes pass, as a
backstop for events that never arrived. Convex's hourly sweep is gone; the
hourly `cleanup-expired-upload-sessions` task only expires upload sessions.

## AI usage (Analytics Engine)

Every Workers AI call made inside `runWithAiUsage` (card metadata for text,
links and images, Whisper transcripts and embeddings, when a workflow or queue
step runs them for a card) writes one data point to the `AI_USAGE` dataset
(`teak_ai_usage`; `teak_dev_ai_usage` for the development Worker) through
`meteredAiRun` in `src/ai/aiUsage.ts`: index `[userId]`, blobs
`[convexSiteUrl, model, functionId, outcome]` and doubles
`[calls, errors, inputTokens, outputTokens, costUsd, latencyMs]`, with the cost
from the Workers AI price list in `src/ai/aiPricing.ts`. Calls
outside a card's context (search, ops Convex calls directly) are not charged
to anyone, and a failed write never fails the call.

The hourly rollup (`src/ai/aiUsageRollup.ts`) queries the Analytics Engine SQL API
for today and yesterday (UTC), per deployment, weighting every sum by
`_sample_interval`, and sets each user's absolute totals for the day with
`adminUsage:replaceDailyUsage`, at most 200 users a call. A repeated run writes
the same numbers again. It needs the `ANALYTICS_ACCOUNT_ID` and
`AI_USAGE_DATASET` vars and the `ANALYTICS_API_TOKEN` secret; without the
token it is skipped and records no heartbeat. The `admin-daily-snapshot`
runs at 02:00 UTC, after the 00:15 and 01:15 rollups have finalized yesterday.

## Export archive lifecycle

An export's snapshot is the ids of the cards it takes, kept in the export
workflow's own `snapshot page N` step results (200 ids, about 7 KB, a page).
`dataExport:getExportSnapshotPage` pages the owner's live cards newest first
and writes nothing; the archive step then reads the cards' current contents
100 at a time with `getExportCardsByIds`, leaving out any deleted since. So a
card edited during an export is archived as edited, and Convex writes no row
per card. A run that snapshotted on an older Worker, or that reaches a Convex
deployment without the query (the Worker deploys first), uses
`exportJobItems` rows instead and drains them when it ends.

Export archives, their `.checkpoint.json` and `.result.json` sidecars and the
transient `.manifest.json` live under the top-level `exports/<userHash>/`
prefix (`dev/exports/` for development), not under `users/`. Convex still
deletes a ready export when it expires after 7 days (`cleanupExpiredExports`)
and with the account, and a job that fails or is canceled once its archive
build has started queues its artifacts for deletion in its `fail export` step,
but an R2 lifecycle rule is the backstop for anything
that path misses: artifacts of failed or canceled jobs, manifests whose
best-effort delete failed, and deletes that errored. Download links are already
refused after expiry, so the extra day costs nothing.

The rules are bucket configuration, not part of `wrangler.jsonc`.
`scripts/cloudflare-r2-lifecycle.ts` holds them for both buckets: exports
(`exports/` and `dev/exports/`) expire after 8 days, incomplete multipart
uploads are aborted after a day, and the event notifications described under
"R2 events and pending uploads" are set. `bun run r2:lifecycle` shows what
would change, `--check` exits 1 when a bucket has drifted, and `--apply` makes
the changes. It only creates, updates and deletes lifecycle rules whose id,
and notification rules whose description, starts with `teak-`; anything else
on the buckets is left as it is (the hand-made `expire-exports` and
`expire-dev-exports` rules can be removed once the `teak-` ones exist). It
needs `CLOUDFLARE_API_TOKEN` with Workers R2 Storage: Edit and Queues: Read
(Workers R2 Storage: Read for a dry run or `--check`); the queues must exist
before `--apply`. Exports
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
with no traversal segments (`src/storage/upload.ts`). Server-generated media signs
without a bound size and relies on the worker's hard cap instead.

Convex owns authorization, durable product state, and workflow orchestration;
this Worker is the one canonical implementation for file-byte operations.

WASM modules are statically imported and arrive as build-time compiled
`WebAssembly.Module`s under wrangler (see `src/images/wasm.ts`).

## Save by email

The `email()` handler (`src/email`) turns mail sent to
`save@<INBOUND_EMAIL_DOMAIN>` into cards. Email Routing on `in.teakvault.com`
(production) and `in-dev.teakvault.com` (development) sends `save@` there
with a literal rule whose action is **Send to a Worker** → `core-worker` or
`core-worker-dev`; Subaddressing is on, so `save+anything@` reaches the same
rule. Any other address on the subdomain matches no rule and Cloudflare
refuses it. Until 30 Oct 2026 this ran as its own Worker
(`teak-email-prod` / `teak-email-dev`, `apps/email-worker`).

Setting up Save by email on a deployment of your own is in the public
self-hosting guide (`apps/docs/content/docs/(open-source)/self-hosting.mdx`,
"Save by email").

### How a message is handled

1. **Address.** The envelope recipient must be `save@<INBOUND_EMAIL_DOMAIN>`;
   `save+anything@` is the same address and letter case never matters. Any
   other local part is refused in the SMTP session
   (`550 5.1.1 Unknown address`).
2. **Automated mail** (an `Auto-Submitted` header other than `no`, an empty
   envelope sender, or `Precedence: bulk|junk|list` with a `List-Id`) is
   accepted and dropped. Nothing is ever sent back.
3. **Size.** Over 25 MiB is refused (`552`). Email Routing's own cap is
   25 MiB including base64, so attachments top out around 18 MB per email.
4. **Sender.** The message is parsed with `postal-mime` (`src/email/auth.ts`). The
   From header must hold exactly one address, and the **topmost**
   authentication header must be Cloudflare's own (authserv-id
   `mx.cloudflare.net`) with `dmarc=pass` and `header.from` equal to that
   address's domain. Headers a sender wrote sit below Cloudflare's, so a
   forged `mx.cloudflare.net` pass further down is never read. Anything else
   is refused (`550 5.7.1 This address can't save to Teak`).
5. **Convex.** The verified sender, subject, Message-ID, date, the text and
   HTML bodies (each cut to `MAX_BODY_BYTES` as encoded in the JSON request,
   never mid-character, so the request stays under Convex's 3 MiB) and the
   attachments' names, types and sizes are POSTed to
   `${CONVEX_SITE_URL}/inbound/email`, signed with
   `EMAIL_INBOUND_SIGNING_SECRET` (`src/email/payload.ts`: HMAC-SHA256 of
   `teak-inbound-email\nv1\n<path>\n<timestamp>\n<sha256(body)>`).
   - `200`: accepted. Convex saved the body card, dropped the message
     silently (over the hourly limit or the free card limit), or had already
     saved it (a receipt per message makes retries safe).
   - `404 unknown_sender`: not a Teak account, Save by email turned off for
     it, or an address Convex won't take: refused with the same `550 5.7.1`.
   - `5xx` (including `503 rate_limited`) or a network failure: tried three
     times (1 s, then 3 s apart), then the handler throws so the sending
     server retries later.
   - Any other status (a signing or configuration fault): thrown at once.
6. **Attachments** (`src/email/attachments.ts`). Files and inline photos are kept;
   S/MIME signatures, `winmail.dat`, calendar invites and inline images the
   HTML shows that are under 16 KB (logos, spacers) are skipped; at most 50.
   For each part Convex accepted, it returns a signed upload URL on this
   Worker's own origin, so the handler PUTs the bytes through the fetch
   handler in-process (two at a time, three tries each), then
   POSTs `/inbound/email/attachments` so Convex turns it into a card. A part
   the upload route refuses (a 4xx other than 408 or 429) is skipped and its
   pending object swept later. If a PUT or finalize still fails for a
   transient reason (a 5xx, a 408 or 429, or the network) after the others
   are done, the handler throws, so the sender retries the whole email;
   Convex's receipt then re-signs only the attachments not yet
   saved. A finalize that finds another one holding the attachment, or one
   Convex scheduled that then fails, gets a follow-up in Convex after the
   two-minute claim expires (three at most).

Logs (`wrangler tail`) carry outcomes, reasons and counts only: never an

### Configuration

| Name | Kind | Production | Development |
| --- | --- | --- | --- |
| `INBOUND_EMAIL_DOMAIN` | var | `in.teakvault.com` | `in-dev.teakvault.com` |
| `MAX_BODY_BYTES` | var | `1048576` | `1048576` |
| `EMAIL_INBOUND_SIGNING_SECRET` | secret | its own value | its own value |

The handler posts to the first deployment in `CONVEX_SITE_URLS`. The secret
is one value per environment, set on both sides: in the Convex dashboard of
the deployment, and on the Worker that posts to it
(`bunx wrangler secret put EMAIL_INBOUND_SIGNING_SECRET`, with
`--config development/wrangler.jsonc` for development).

**Rollback:** disable the subdomain's `save@` rule (or Email Routing on the
subdomain). Convex can stay deployed.

Tests: `src/email/*.test.ts` run the handler against `.eml` fixtures in
`src/email/fixtures/` with a fake network (`src/test/emailSupport.ts`), and
`src/email/worker.test.ts` covers the `email()` entry point.

## Commands

```bash
bun install
bun test            # unit + handler tests (fixtures in src/fixtures), plus container/src
bun run cf-typegen  # refresh generated Worker bindings/runtime types
bun run cf-typegen:check  # fail if worker-configuration.d.ts is stale (Unit Tests runs it)
bun run typecheck   # tsc --noEmit for the Worker and the Container
bunx wrangler deploy --dry-run --outdir /tmp/out   # bundle size check; builds the
                    # renderer image, so it needs Docker (add
                    # --containers-rollout=none to check the Worker alone)
bun run deploy      # wrangler deploy (creates files.teakvault.com custom domain)

# Local development
bun run dev              # wrangler dev --remote with the development config (runs on Cloudflare)
                         # (needs development/.dev.vars: bun run sync:cloudflare-dev --isolated)
bun run dev:local        # wrangler dev (isolated Miniflare, low-fidelity Images)
# Or from repo root:
bun run dev core        # same as above, development config
bun run dev core:local  # same as above, isolated

# Config parity (read-only, never prints secrets)
bun run check:cloudflare   # reports Convex prod/dev parity and dev storage state without printing values
bun run sync:cloudflare-dev # securely writes the dev signing secret to ignored .dev.vars

# Development Worker (Convex dev uses it)
bun run deploy:development           # workers.dev only, no route; builds the containers, so needs Docker
bun run sync:cloudflare-dev --isolated  # from repo root; writes development/.dev.vars
```

`wrangler dev` builds and runs the renderer Container locally, which needs a
running Docker daemon. To work on other parts of the Worker without Docker,
set `"dev": { "enable_containers": false }` in your local copy of the config;
media jobs then answer `RENDERER_UNAVAILABLE`.

`deploy:development` is a plain `wrangler deploy --config
development/wrangler.jsonc` with no Convex check. Workers Builds deploys
both Workers from `main` (`core-worker` with `wrangler.jsonc`,
`core-worker-dev` with this config), so run it by hand only to bootstrap or to
test a branch. The committed config can only bind the development
bucket and vector index, its own Durable Object namespaces (deletion gates and
the media renderer) and workers.dev, with no route (tests in `src/deployment.test.ts` and
`scripts/core-worker-dev-boundary.test.ts` enforce that). It sets no secret.
Its `FILES_SIGNING_SECRET` and `WORKFLOW_RPC_ROOT_SECRET` are put separately
(`bunx wrangler secret put <NAME> --config development/wrangler.jsonc`).
`FILES_BASE=https://core-worker-dev.praveenjuge.workers.dev FILES_SIGNING_SECRET=… bun scripts/check-files-readiness.ts`
proves the key and every binding with a signed `capabilities` request, and
`check:cloudflare` checks the key is distinct from production.

## Secrets and local vars

Both Wrangler configs list `EMAIL_INBOUND_SIGNING_SECRET`,
`FILES_SIGNING_SECRET` and `WORKFLOW_RPC_ROOT_SECRET` under
`secrets.required`: `wrangler deploy` (and Workers Builds) fails while any of
them is missing on that Worker, `wrangler types` types them, and `wrangler dev`
loads only those three from `.dev.vars` and warns when one is absent.
`ANALYTICS_API_TOKEN` is optional and not listed.

- `EMAIL_INBOUND_SIGNING_SECRET` — signs what Save by email posts to Convex;
  must match that deployment's value (see "Save by email").
- `FILES_SIGNING_SECRET` — must match its corresponding Convex deployment.
  Set production with `bunx wrangler secret put FILES_SIGNING_SECRET`.
- `WORKFLOW_RPC_ROOT_SECRET` — Worker-only root of each Convex deployment's
  `WORKFLOW_RPC_SECRET`. Set with
  `bunx wrangler secret put WORKFLOW_RPC_ROOT_SECRET`, then give every
  deployment in `CONVEX_SITE_URLS` its derived secret:
  `WORKFLOW_RPC_ROOT_SECRET=… bun scripts/workflow-rpc-secret.ts https://<deployment>.convex.site`
  and `bunx convex env set WORKFLOW_RPC_SECRET <output>` on that deployment.
  Until a deployment has it, its background work stays queued in its outbox.
  Never copy the root secret to Convex.
- `ANALYTICS_API_TOKEN` — Cloudflare API token with Account Analytics: Read
  for the hourly AI usage rollup. Set with
  `bunx wrangler secret put ANALYTICS_API_TOKEN` (and
  `--config development/wrangler.jsonc` for the development Worker); unset
  skips the rollup.
- `POSTHOG_PROJECT_TOKEN` — public PostHog project token for error reports,
  card processing's events and the backend events Convex hands to `dispatch`
  (sent with a plain `fetch`). A plain var in the production
  `wrangler.jsonc`; the development Worker has none, so it reports nothing.

- `apps/core-worker/.dev.vars` (ignored) — per-developer local overrides for
  `wrangler dev`. Example: `FILES_SIGNING_SECRET=...`. Do not commit. The
  canonical dev routing (`R2_KEY_PREFIX`, `FILES_BASE`) lives in
  Convex env, not `.dev.vars`.
- `apps/core-worker/development/.dev.vars` (ignored) — the isolated
  development Worker's local key. `sync:cloudflare-dev --isolated` and
  `bun run dev` refuse to run unless Convex dev uses the isolated Worker,
  bucket and its own signing key.

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
old `teak-files-dev` R2 bucket was emptied and deleted on 19 Oct 2026. The
`teak-files-dev` Worker that followed it is now `core-worker-dev`.

## Development storage isolation

Convex dev uses the development Worker (bucket
`teak-files-development-20261006`):
`FILES_BASE=https://core-worker-dev.praveenjuge.workers.dev`,
`R2_KEY_PREFIX=dev/`, and a `FILES_SIGNING_SECRET` and `WORKFLOW_RPC_SECRET`
of its own. The production Worker's `CONVEX_SITE_URLS` lists only the
production deployment. Convex holds no S3 credentials.

`bun run check:cloudflare` still recognizes the older shared routing
(`https://files.teakvault.com` and the production signing key)
and blocks any mix of the two. Isolated dev must never reuse a production
credential.

The switch ran on 19 Oct 2026 while dev held no cards, so no objects were
copied and no old `dev/` keys were frozen. The few `dev/` objects left in
`teak-files-prod` are read by nothing. Rolling back means restoring the three
old dev Convex values and adding the dev origin back to the production
Worker's `CONVEX_SITE_URLS`; files saved since the switch would then be
missing.

Builds for the dev deployment (`reminiscent-kangaroo-59`) allow exactly this
origin: the web CSP and shared media recovery. No
`NEXT_PUBLIC_FILES_BASE` is needed for it. Production builds never allow it. If
the deployed workers.dev origin differs, change `DEVELOPMENT_FILES_ORIGIN` and
its client copies together (a drift test checks them).

## Local development experience

- `bun run dev` at repo root starts the default stack (web + Convex) via
  Turborepo. `bun run dev --all` starts every surface (web, convex, raycast,
  docs, extension).
- `bun run dev core` — `wrangler dev --remote` with the development config:
  your local code runs on Cloudflare against the development bucket, AI and
  Images, never production's. Queue consumers don't run in remote mode, so
  test queue-driven work (deletions, upload cleanup, AI backfill) on the
  deployed `core-worker-dev`.
- `bun run dev core:local` — isolated Miniflare storage with low-fidelity
  Images emulation; no remote credentials needed.
- `bun run check:cloudflare` — read-only names/parity check without exposing
  secret values.
