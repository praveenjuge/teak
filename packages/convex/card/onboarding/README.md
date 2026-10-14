# Getting-started files

New accounts get one card of each type (`ONBOARDING_CARDS` in `../defaultCards.ts`). `../onboardingFiles.ts` stores every file below in the new account at once, then inserts all eight cards in one mutation, already processed. The grid fills once and nothing moves or reflows afterwards, and sign-up runs no AI or rendering work.

`files.ts` embeds these files so every deployment, self-hosted ones included, has them without a network fetch. After changing a file, run:

```bash
bun run scripts/onboarding-files.ts
```

`scripts/onboarding-files.test.ts` fails while `files.ts` is out of date.

## Originals

| File | Made from |
| --- | --- |
| `coral-lily.webp` | [Photo by Jesse Bauer](https://unsplash.com/photos/macro-photography-of-orange-flower-kTiJ4R3WVdw) on Unsplash (Unsplash License), 2400×1600 |
| `brand-refresh-voice-memo.m4a` | Text to speech (Piper, `en_US-lessac-high` voice), AAC mono 96 kbps |
| `teak-search-cheat-sheet.pdf` | `teak-search-cheat-sheet.html`, printed to A4 in Chromium |
| `find-anything-in-teak.mp4` | A 2× screen recording of the web app, H.264 at 1920×1200 (`-preset veryslow -tune stillimage -crf 24 -g 60`, with keyframes forced at the ten scrub times) |

The voice memo's transcript must keep the word "serif", which its card's note asks people to search for.

## Processed output

The cards carry what Teak's own pipeline made of the originals: dimensions, duration, waveform and transcript (`processed.ts`), colors, AI summaries and tags, and these derivatives:

| File | Card field |
| --- | --- |
| `cheat-sheet-thumbnail.png` | The PDF's `thumbnailKey` (its first page) |
| `tour-thumbnail.jpg` | The video's `thumbnailKey` (a clean frame at 0.7 s) |
| `tour-scrub.jpg` | The video's `scrubKey` (10 frames of 360×224), built with the Files renderer's own `tileCommand` and `spriteCommand` |
| `apps-image.webp` | The link's `linkPreview.imageStorageKey` (teakvault.com's Open Graph image) |
| `apps-screenshot.jpg` | The link's `linkPreview.screenshotStorageKey` (teakvault.com/apps at 2×) |

To capture them again after changing an original: sign up a fresh account on the dev deployment, wait until its cards finish processing, read them with `bunx convex data cards --format jsonArray`, and download each derivative through a signed Files Worker URL. Copy the facts into `ONBOARDING_CARDS` and `processed.ts`; summaries and tags may be tightened by hand.

Keep the set small: it is embedded in the backend bundle, so it adds to every deploy (about 4.8 MB of base64 today).
