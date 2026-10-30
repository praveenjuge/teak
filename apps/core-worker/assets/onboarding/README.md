# Getting-started files

New accounts get one card of each type (`ONBOARDING_CARDS` in `packages/convex/card/defaultCards.ts`). `packages/convex/card/onboardingFiles.ts` asks this Worker to store every file below in the new account at once (the `store-onboarding-files` op, `apps/core-worker/src/storage/onboardingFiles.ts`), then inserts all eight cards in one mutation, already processed. The grid fills once and nothing moves or reflows afterwards, and sign-up runs no AI or rendering work.

The files ship with the Worker as [static assets](https://developers.cloudflare.com/workers/static-assets/) (`assets` in `apps/core-worker/wrangler.jsonc`), read through `env.ASSETS`. They do not count toward the Worker's script size, and the Worker runs first for every request, so none of them is served at a public path. `.assetsignore` keeps this README and the cheat sheet's HTML source out of the upload. A file a card names must exist here; `packages/convex/__tests__/card/defaultCards.test.ts` checks.

## Originals

| File | Made from |
| --- | --- |
| `coral-lily.webp` | [Photo by Jesse Bauer](https://unsplash.com/photos/macro-photography-of-orange-flower-kTiJ4R3WVdw) on Unsplash (Unsplash License), 2400×1600 |
| `brand-refresh-voice-memo.m4a` | Text to speech (Piper, `en_US-lessac-high` voice), AAC mono 96 kbps |
| `teak-search-cheat-sheet.pdf` | `teak-search-cheat-sheet.html`, printed to A4 in Chromium |
| `find-anything-in-teak.mp4` | A 2× screen recording of the web app, H.264 at 1920×1200 (`-preset veryslow -tune stillimage -crf 24 -g 60`, with keyframes forced at the ten scrub times) |

The voice memo's transcript must keep the word "serif", which its card's note asks people to search for.

## Processed output

The cards carry what Teak's own pipeline made of the originals: dimensions, duration, waveform and transcript (`packages/convex/card/onboarding/processed.ts`), colors, AI summaries and tags, and these derivatives:

| File | Card field |
| --- | --- |
| `cheat-sheet-thumbnail.png` | The PDF's `thumbnailKey` (its first page) |
| `tour-thumbnail.jpg` | The video's `thumbnailKey` (a clean frame at 0.7 s) |
| `tour-scrub.jpg` | The video's `scrubKey` (10 frames of 360×224), built with the Files renderer's own `tileCommand` and `spriteCommand` |
| `apps-image.webp` | The link's `linkPreview.imageStorageKey` (teakvault.com's Open Graph image) |
| `apps-screenshot.jpg` | The link's `linkPreview.screenshotStorageKey` (teakvault.com/apps at 2×) |

To capture them again after changing an original: sign up a fresh account on the dev deployment, wait until its cards finish processing, read them with `bunx convex data cards --format jsonArray`, and download each derivative through a signed Core Worker URL. Copy the facts into `ONBOARDING_CARDS` and `processed.ts`; summaries and tags may be tightened by hand.

Keep the set small: every new account stores its own copy in R2 (about 3.6 MB today), and each file must stay under the 25 MiB static asset limit.
