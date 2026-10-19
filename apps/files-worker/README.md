# @teak/files-worker

The Cloudflare Worker for Teak file delivery, uploads, processing, imports,
and exports. Production is the `teak-files-prod` Worker (`wrangler.jsonc`,
renamed from `teak-files-proxy` on 19 Oct 2026; its container apps keep the
`teak-files-proxy-*` names). It serves `files.teakvault.com` from the
`teak-files-prod` bucket, for the production Convex deployment only. The
pre-convergence `files-dev` Worker/domain and the old `teak-files-dev` R2
bucket are gone.

Development runs this same source as the `teak-files-dev` workers.dev
Worker (`development/wrangler.jsonc`) on the private
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
users, owns card state and validates uploads — while background work
(Cloudflare Workflows, Queues and Cron Triggers; see "Background work"),
stored-file processing and storage transfers run in this worker.
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


### MCP at the edge

MCP clients open every session with `initialize`, a
`notifications/initialized`, `tools/list`, and then `ping` now and then. For a
`/mcp` POST the edge has tied to a Teak user (`user:` identity) and charged to
that user's limit, `src/mcpEdge.ts` answers those messages itself: if every
message in the body (one, or a batch of up to 100) is one of them, the Worker
replies with the JSON-RPC result, `202` with no body for notifications alone,
and the headers Convex adds (`MCP_CORS_HEADERS`, the API's CORS headers,
`X-Request-Id`, `no-store`). The tool list and the `initialize` result come
from `packages/convex/mcp/protocol.ts`, which Convex's `mcp/httpServer.ts`
uses too, so both answer byte for byte the same; `ping` answers `{}` in both.
Anything else is forwarded unchanged: a tool call (alone or in a batch), an
unknown method or invalid message, a body Convex would refuse (wrong `Accept`
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
  (dev) prefix (limit ≤1000, opaque cursor) — used by the weekly
  orphaned-object reconciliation report. `cleanup-stale-pending-uploads`
  deletes pending uploads older than a day under one of those prefixes, ten
  list pages a call; the weekly cron's backstop sweep runs it in-process.
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
  ffmpeg and poppler) and set `RENDERER_URL=http://localhost:18080`. In a
  Claude Code cloud session, build the image with
  `scripts/cloud-docker-build.sh` and run the CI job's steps
  (`.agents/cloud.md`, "Containers").

## Import and audio processing

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
SSRF guard Convex used runs unchanged, bundled by path rather than copied:

- `packages/convex/linkMetadata/ssrf.ts`: http(s) only, standard ports, no
  credentials, every resolved address public, every redirect hop rechecked;
- `fetcher/src/pinnedFetch.ts`: the connection goes to the addresses that
  were checked, so DNS rebinding between the check and the connection cannot
  redirect it;
- `fetcher/src/remoteImageDimensions.ts`: images must have readable
  dimensions within the pixel cap.

Card processing (`src/workflows/cardProcessing/`) runs the same `safeFetch`
in the Worker for the requests it makes to user URLs (Bluesky, Mastodon,
Reddit and TikTok post APIs): it resolves each hop's host with DNS over HTTPS
(`src/pinnedHop.ts`) and sends one hop at a time to `POST /hop`
(`fetcher/src/hop.ts`), which checks the addresses again with the same policy,
connects only to them, and returns a redirect unfollowed, so the Worker checks
its target before the next hop. A hop carries only `accept` and `user-agent`
and brings back at most its byte cap plus one.

Podcast episode audio (`podcastAudio.ts`) is larger than a hop holds, so it
goes to `POST /hop-stream` (`createContainerStreamingFetch`): the same checks,
with the body streamed back as it arrives, up to 100 MB and five minutes.
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
(`src/linkPage.ts`), as Convex did with a second `scrape-html` call; a failed
or unavailable browser keeps the static result. The result carries the
selectors, the page's URL after redirects, the charset, which pass produced
them (`static` or `browser`), and the decoded page as gzipped UTF-8 for
parsers that need the whole page (Instagram media). A page the Container
refuses comes back as a result, not an error: `blocked_url`, `http_error`
(with its status), `unsupported_type` (with the type), `too_large` or
`fetch_failed`.

Convex's link metadata step calls `fetch-link-page` whenever a Files Worker is
configured, and the deploy readiness gate requires it. A refusal maps to the
outcome Convex gave the same failure before: `blocked_url` and a definitive
4xx fail the preview, and everything else, including a busy or unavailable
Worker, retries the step. Only a stack without a Files Worker (the local E2E
stack) still fetches the page in Convex, with the same pinned policy and
static HTML only.

Fetched pages are kept for 24 hours in the `LINK_PAGE_CACHE` KV namespace,
keyed by a hash of the URL and the selectors, so a link many people save is
fetched and rendered once a day. Every fetch is anonymous (no cookies or
credentials), so the cached page is what anyone requesting that exact URL
would get. A page whose `Cache-Control` says `no-store` or `private` is never
kept, nor is any refusal, nor a page whose Browser Run render failed (the
next save renders it again); a page from an older fetcher image, which does
not report its `Cache-Control`, is not kept either. A KV read or write that fails
falls back to fetching. Without the binding (development, tests) nothing is
cached.

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

## Card embeddings (Vectorize)

`CARD_VECTORS_0` binds the `teak-cards-0` Vectorize index (768 dimensions,
cosine, a string metadata index on `type`), which holds card embeddings for
semantic search, one namespace per user. `capabilities` reports `vectors` when it is bound. The model, prompts and
shard layout are in `.agents/semantic-search.md`.

Four signed ops read and write the index (`src/vectors.ts`):

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

Steps read and write Convex through one signed endpoint,
`POST <convex.site>/__workflow/v1` (`src/convexRpc.ts` →
`packages/convex/workflowGateway.ts`), which runs one function from
`packages/convex/workflowRpcAllowlist.ts` per call. Every card-processing
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

`src/cron.ts` runs the background tasks that used to be Convex crons. The
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
| `0 2 * * *` | Card cleanup: starts the maintenance workflow, which records its own heartbeat |
| `0 3 * * *` | Export cleanup (maintenance workflow) |
| `0 4 * * 1` | Orphan sweep (maintenance workflow), and the pending-upload backstop sweep (`sweep-stale-pending-uploads`) |
| `0 */6 * * *` | AI metadata backfill into the `AI_BACKFILL` queue (`ai-metadata-backfill`) |
| `15 * * * *` | AI usage rollup (`ai-usage-rollup`; see below) |
| `45 * * * *` | Workflow reconcile (`reconcile-workflows`) |

The reconcile (`src/workflowReconcile.ts`) asks Convex for runs that have not
reported for longer than their kind allows (`workflowDispatch:listStale`) and
looks each instance up through its binding: `complete` reports complete, and
`errored` or `terminated` reports errored with the instance's error, so the
job behind it fails instead of staying "running". An instance Workflows does
not know (`instance_missing`) means the hand-over was lost after Convex
claimed the row, so the row is sent again (up to the dispatch attempt limit).
Queued, running, waiting and paused runs are left alone, and a lookup that
fails for another reason is tried again the next hour. It then prunes finished dispatch rows
(`workflowDispatch:pruneFinished`, at most ten pages).

## WorkOS webhook queue

WorkOS posts webhooks to
`https://files.teakvault.com/__webhooks/workos/<convex-site-host>`. The host
must be one of `CONVEX_SITE_URLS`; the production endpoint is
`https://files.teakvault.com/__webhooks/workos/uncommon-ladybug-882.convex.site`.
`src/queues/workosEvents.ts` checks the request cheaply (a `workos-signature`
of at most 1,024 characters whose `t=` timestamp is at most three minutes old,
the WorkOS SDK's tolerance, and at most five minutes ahead,
`Content-Type: application/json`, a body of at most 120 KiB so it fits a
128 KB queue message), charges `UNKNOWN_CREDENTIAL_LIMITER` by address, queues
`{ convexSiteUrl, body, signature, receivedAt }` on `WORKOS_EVENTS` and answers
200 at once. The Worker does not hold the webhook secret.

The consumer posts the exact body with the original signature to that
deployment's `/workos/webhook`, which verifies the signature and dedupes
events as before (the route still works directly; the E2E stack's emulator
posts to it). A 2xx acknowledges the message; 400, 401, 403, 413 and 415 mean a
forged or malformed webhook and drop it; a 5xx or network failure retries
after 30 s, doubling up to 15 minutes, ten times, and then lands in
`teak-workos-events-dlq`. The WorkOS SDK refuses a signature older than three
minutes, so a 401 for a message signed longer ago than that is a webhook that
may have aged out while it waited, and the dead-letter consumer handles each
message that exhausted its retries the same way: the Worker hands the body and
signature to its deployment (`workosWebhook:recordUndeliverableWebhook`), which
verifies the signature on everything but its age and only then records the
event as undeliverable (reason `delivery_failed`, once per event ID, skipped
when the event was applied after all), where the admin health view shows it.
A forged webhook is never recorded. Either way the hourly WorkOS event catch-up applies the event from
the Events API.

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
backstop for events that never arrived. Convex's hourly sweep is gone; its
cron (`cleanup-expired-upload-sessions`) now only expires upload sessions.

## AI usage (Analytics Engine)

Every Workers AI call made inside `runWithAiUsage` (card metadata for text,
links and images, Whisper transcripts and embeddings, when a workflow or queue
step runs them for a card) writes one data point to the `AI_USAGE` dataset
(`teak_ai_usage`; `teak_dev_ai_usage` for the development Worker) through
`meteredAiRun` in `src/aiUsage.ts`: index `[userId]`, blobs
`[convexSiteUrl, model, functionId, outcome]` and doubles
`[calls, errors, inputTokens, outputTokens, costUsd, latencyMs]`, with the cost
from the Workers AI price list in `packages/convex/shared/aiPricing.ts`. Calls
outside a card's context (search, ops Convex calls directly) are not charged
to anyone, and a failed write never fails the call.

The hourly rollup (`src/aiUsageRollup.ts`) queries the Analytics Engine SQL API
for today and yesterday (UTC), per deployment, weighting every sum by
`_sample_interval`, and sets each user's absolute totals for the day with
`adminUsage:replaceDailyUsage`, at most 200 users a call. A repeated run writes
the same numbers again. It needs the `ANALYTICS_ACCOUNT_ID` and
`AI_USAGE_DATASET` vars and the `ANALYTICS_API_TOKEN` secret; without the
token it is skipped and records no heartbeat. Convex's `admin-daily-snapshot`
runs at 00:45 UTC, after the 00:15 rollup has finalized yesterday.

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
and with the account, but an R2 lifecycle rule is the backstop for anything
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
bun run dev files        # same as above, development config
bun run dev files:local  # same as above, isolated

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
both Workers from `main` (`teak-files-prod` with `wrangler.jsonc`,
`teak-files-dev` with this config), so run it by hand only to bootstrap or to
test a branch. The committed config can only bind the development
bucket and vector index, its own Durable Object namespaces (deletion gates and
the media renderer) and workers.dev, with no route (tests in `src/deployment.test.ts` and
`scripts/files-worker-dev-boundary.test.ts` enforce that). It sets no secret.
Its `FILES_SIGNING_SECRET` and `WORKFLOW_RPC_ROOT_SECRET` are put separately
(`bunx wrangler secret put <NAME> --config development/wrangler.jsonc`).
`FILES_BASE=https://teak-files-dev.praveenjuge.workers.dev FILES_SIGNING_SECRET=… bun scripts/check-files-readiness.ts`
proves the key and every binding with a signed `capabilities` request, and
`check:cloudflare` checks the key is distinct from production.

## Secrets and local vars

Both Wrangler configs list `FILES_SIGNING_SECRET` and
`WORKFLOW_RPC_ROOT_SECRET` under `secrets.required`: `wrangler deploy` (and
Workers Builds) fails while either is missing on that Worker, `wrangler types`
types them, and `wrangler dev` loads only those two from `.dev.vars` and warns
when one is absent. `ANALYTICS_API_TOKEN` is optional and not listed.

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
- `POSTHOG_PROJECT_TOKEN` — public PostHog project token for error reports
  (errors only, sent with a plain `fetch`). A plain var in the production
  `wrangler.jsonc`; the development Worker has none, so it reports nothing.

- `apps/files-worker/.dev.vars` (ignored) — per-developer local overrides for
  `wrangler dev`. Example: `FILES_SIGNING_SECRET=...`. Do not commit. The
  canonical dev routing (`R2_BUCKET`, `R2_KEY_PREFIX`, `FILES_BASE`) lives in
  Convex env, not `.dev.vars`.
- `apps/files-worker/development/.dev.vars` (ignored) — the isolated
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
`teak-files-dev` Worker is unrelated: it is the current development Worker.

## Development storage isolation

Convex dev uses the development Worker: `R2_BUCKET=teak-files-development-20261006`,
`FILES_BASE=https://teak-files-dev.praveenjuge.workers.dev`,
`R2_KEY_PREFIX=dev/`, and a `FILES_SIGNING_SECRET` and `WORKFLOW_RPC_SECRET`
of its own. The production Worker's `CONVEX_SITE_URLS` lists only the
production deployment. Convex holds no S3 credentials.

`bun run check:cloudflare` still recognizes the older shared routing
(`teak-files-prod`, `https://files.teakvault.com`, production signing key)
and blocks any mix of the two. Isolated dev must never reuse a production
credential.

The switch ran on 19 Oct 2026 while dev held no cards, so no objects were
copied and no old `dev/` keys were frozen. The few `dev/` objects left in
`teak-files-prod` are read by nothing. Rolling back means restoring the four
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
- `bun run dev files` — `wrangler dev --remote` with the development config:
  your local code runs on Cloudflare against the development bucket, AI and
  Images, never production's. Queue consumers don't run in remote mode, so
  test queue-driven work (deletions, upload cleanup, AI backfill) on the
  deployed `teak-files-dev`.
- `bun run dev files:local` — isolated Miniflare storage with low-fidelity
  Images emulation; no remote credentials needed.
- `bun run check:cloudflare` — read-only names/parity check without exposing
  secret values.
