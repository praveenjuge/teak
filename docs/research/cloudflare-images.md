# Cloudflare image transformations for Teak

Research and implementation decision: 2026-08-25

## Decision

Teak uses Cloudflare image transformations as the canonical optimization and
delivery layer for image renditions while keeping every original in the
existing private R2 bucket.

This is intentionally **not Cloudflare Images hosted storage**. Remote image
transformations accept sources up to 100 MB, matching Teak's upload contract;
hosted Images accepts only 10 MB. R2 also remains the correct source of truth
for signed original downloads, exports, lifecycle handling, and every
non-image file. Cloudflare recommends the R2 plus transformations model when
an application needs custom storage access or lifecycle control.

Primary sources:

- [Cloudflare Images introduction](https://developers.cloudflare.com/images/get-started/introduction/)
- [Transformation overview](https://developers.cloudflare.com/images/optimization/transformations/overview/)
- [Limits and supported formats](https://developers.cloudflare.com/images/get-started/limits/)
- [Transform via Workers](https://developers.cloudflare.com/images/transform-images/transform-via-workers/)
- [Pricing](https://developers.cloudflare.com/images/pricing/)

## Product contract

The integration preserves these guarantees:

- uploads remain direct to private R2 and may be as large as 100 MB;
- originals remain downloadable through the existing signed file route;
- image rendition URLs are signed and expire, and raw R2 keys are never public;
- palette extraction remains part of image processing and color search;
- SVG images receive usable raster renditions;
- all Teak clients receive stable product URLs rather than arbitrary
  Cloudflare parameters.

## Architecture

Convex returns three roles for an image card:

| Role | Source | Behavior |
| --- | --- | --- |
| `fileUrl` | private R2 original | signed download/view URL; original bytes |
| `thumbnailUrl` | `grid` rendition | maximum 512 by 512, quality 80 |
| `detailUrl` | `detail` rendition | maximum 1600 by 1600, quality 85 |

Both renditions use `fit: scale-down`, strip metadata, apply conservative
sharpening, preserve supported animation, and negotiate AVIF then WebP from
the request `Accept` header. The finite rendition allowlist avoids unbounded
transform combinations and prevents clients from supplying source URLs,
dimensions, formats, or other transform options.

The public request path is:

```text
Convex signed URL
  -> files.teakvault.com/__images/v1/{grid|detail}/{encoded R2 key}
  -> Worker verifies rendition, expiry, and HMAC
  -> Worker signs a five-minute internal source request
  -> Cloudflare image resizing fetches the private source route
  -> source route requires both Cloudflare image-resizing Via and HMAC auth
  -> optimized response is returned with private browser caching
```

The inner source uses Cloudflare's authenticated-origin support with
`origin-auth: share-publicly`. That setting allows the transformed bytes to be
shared in Cloudflare's optimized cache; it does not expose the original route,
which rejects ordinary browser requests. The outer URL remains private and
expires after at most eight days.

For image analysis, the Worker requests Cloudflare's JSON image information
for intrinsic dimensions and a 64 by 64 PNG sample for deterministic palette
extraction. This replaces Teak's raster/HEIC decoder and encoder pipeline
without removing color search.

Cloudflare sanitizes but does not resize SVG. Teak therefore keeps only the
resvg WASM path: it rasterizes SVG to PNG for `grid`, `detail`, and the palette
sample, with a 10 MB SVG safety limit. Rendered SVG responses use the Workers
Cache API because Worker-generated responses are not cached automatically.

If a Cloudflare transform temporarily fails, PNG, JPEG, GIF, and WebP may fall
back to the signed original because browsers can render them safely. HEIC and
other non-browser formats fail closed rather than returning unusable bytes.

## Cloudflare capabilities used

- private remote-origin transformations over the existing R2 source;
- automatic AVIF/WebP format negotiation;
- bounded responsive resizing with aspect-ratio preservation;
- animation preservation;
- metadata removal and sharpening;
- JSON image information for width and height;
- small PNG transformation for palette analysis;
- Cloudflare optimized-image caching plus Workers Cache for SVG output;
- authenticated-origin requests with a separate short-lived HMAC;
- `GET` and `HEAD` rendition delivery with `Vary: Accept` and nosniff headers.

Useful capabilities intentionally not added are arbitrary/flexible transforms,
cropping, overlays, watermarks, AI background removal, AI upscaling, hosted
Images uploads, public variants, and a second image identity. They do not solve
the current product requirement and would expand privacy, billing, or client
contracts.

## Code cleanup completed

The integration removes the stored raster derivative pipeline and its repair
cron, transform-version sidecars, custom HEIC decoder, custom WebP encoder,
EXIF parser, thumbhash generation, and their WASM/dependency plumbing. Image
renditions now have one on-demand codepath. PDF/video thumbnails and link
screenshots remain because they generate source media rather than resize image
card originals.

Deletion still removes historical `thumbnailKey`, `previewKey`, and processing
sidecar objects when present, so old derivatives do not become R2 orphans.
Legacy optional schema fields remain readable for existing records. Removing
them requires an explicitly approved migration/backfill and is not part of
this change.

## Limits, cost, and operations

Remote transformations allow a 100 MB source and 100 megapixels, with format-
specific dimension and animation limits documented by Cloudflare. Teak's SVG
path is separately limited to 10 MB. Cloudflare bills remote optimization by
unique source plus transformation combination each calendar month, so two
fixed renditions plus one analysis sample deliberately cap cardinality.

Required configuration stays small:

- Cloudflare zone image transformations must be enabled for `teakvault.com`;
- the files Worker needs its private R2 `BUCKET` binding and
  `FILES_SIGNING_SECRET` secret;
- Convex production needs the matching `FILES_SIGNING_SECRET` and
  `FILES_BASE=https://files.teakvault.com`; development uses its own Worker,
  secret, and `FILES_BASE=https://files-dev.teakvault.com` so its isolated R2
  bucket stays isolated.

No Cloudflare account API key is shipped in application code.

## Verification contract

A release is proven only when all of the following are observed:

1. Automated tests cover signature expiry/tampering, rendition allowlisting,
   Cloudflare options, format negotiation, SVG analysis and size limits,
   palette, fallback, `HEAD`, missing objects, and non-image rejection; a live
   edge check proves SVG cache reuse.
2. The full repository lint, formatting, typecheck, and test suites pass on the
   pinned Bun version.
3. A real image upload in local development shows a transformed grid image,
   transformed detail image, palette colors, and an unchanged original
   download.
4. Development and production signed URLs return successful image responses;
   an unsigned or modified URL is rejected.
5. The production API, CLI, and MCP return/use the same rendition contract.
6. Cloudflare Worker, Convex, web deployment, and relevant GitHub Actions are
   green after merge.

## Follow-up candidates

- Add `srcset` only after the product chooses a third fixed rendition; avoid
  client-controlled widths.
- Measure unique transformation counts, output bytes, cache status, latency,
  fallback rate, and format mix before changing sizes or quality.
- Consider C2PA preservation only if Teak begins presenting provenance; the
  current metadata-removal policy intentionally prioritizes privacy and size.
- Plan a separate migration if legacy derivative schema fields should be
  removed. Do not couple that data change to image delivery.
