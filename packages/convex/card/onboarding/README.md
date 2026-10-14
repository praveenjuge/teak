# Getting-started files

New accounts get one card of each type (`ONBOARDING_CARDS` in `../defaultCards.ts`). The image, voice memo, PDF, and video cards are made from the files here: `../onboardingFiles.ts` uploads each into the new account, then the card is processed like any upload.

`files.ts` embeds these files so every deployment, self-hosted ones included, has them without a network fetch. After changing a file, run:

```bash
bun run scripts/onboarding-files.ts
```

`scripts/onboarding-files.test.ts` fails while `files.ts` is out of date.

| File | Made from |
| --- | --- |
| `coral-flowers.webp` | The homepage demo photo (`apps/docs/public/home-demo/flower.webp`) |
| `brand-refresh-voice-memo.m4a` | Text to speech (Piper, `en_US-lessac-high` voice), AAC mono 56 kbps |
| `teak-search-cheat-sheet.pdf` | `teak-search-cheat-sheet.html`, printed to A4 in Chromium |
| `find-anything-in-teak.mp4` | A screen recording of the web app, H.264 at 1280×800 |

Keep the set small: it is embedded in the backend bundle, so it adds to every deploy. The voice memo's transcript should keep the word "serif", which its card's note asks people to search for.
