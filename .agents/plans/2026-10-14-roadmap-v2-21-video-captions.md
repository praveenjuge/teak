## Goal

Give YouTube and Vimeo link cards a transcript taken from the video's own captions. No video is ever downloaded. The text is stored in `aiTranscript`, so search finds spoken words, and it feeds the AI summary and tags. YouTube links also get their missing details: channel, length and upload date. Phase 21 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- v1 phase 13 (stored text, shipped in #680) (stored text). It reworks `workflows/steps/metadata.ts` and adds `GET /v1/cards/:id/content`, which already falls back to `aiTranscript`.

## Success Criteria

- Saving a YouTube or Vimeo link that has captions stores the transcript in `aiTranscript`. Searching a sentence said in the video finds the card.
- The AI summary and tags reflect what is said, not only the title.
- A video without captions, with private captions, or behind a consent or age wall gets no transcript, and the card completes as today. The step never fails a card.
- YouTube cards show Channel, Length and Uploaded facts.
- Existing videos get transcripts through Refresh details. There is no backfill.
- There is no transcript panel (owner decision). The text is reachable through search, `aiTranscript` in the API, and v1 phase 13's `teak content <id>`.

## Context And Current Facts

- **Rules.** `linkCategoryResolver.ts:61-63`: youtube.com and youtu.be map to `tv` with provider `youtube`. vimeo.com maps to `tv` with no provider.
  - `detectProvider` (`enrichment.ts:177`) returns `youtube`, but `providers/index.ts` has no `youtube` handler, so YouTube cards get no facts.
  - The scraped selectors (`linkMetadata/selectors.ts SCRAPE_ELEMENTS`) include no `itemprop` duration or channel tags.
- **Pipeline order.** `workflows/cardProcessing.ts:156-311` runs link metadata, then categorization, then `steps/metadata.generate`.
  - The `link` branch of `metadata.ts` builds `buildLinkContentParts` and calls `generateLinkMetadata(content, url)`.
  - The same function already sends `aiTranscript` through `updateCardAI` (the audio branch does).
  - Summary input is capped at `MAX_AI_METADATA_INPUT_CHARS` = 6,000 (`packages/files-protocol/src/metadata.ts:4`).
- **The workflow rule.** "New workflow steps are appended at the end." A transcript appended at the end could not feed the summary. Like v1 phase 13's document text, the caption fetch therefore runs inside the existing metadata step's link branch, and no step is added.
- **Search and API.**
  - `aiTranscript` is in `SEARCH_FIELDS` (`card/searchDocumentHelpers.ts:18-25`).
  - The API returns it as `aiTranscript`, and in lists with `include=processing`.
  - Refresh details (`card/updateCard.ts reprocessCardForUserHandler`) clears summary, tags and transcript and runs the pipeline again.
- **Limits.**
  - `FILES_TRANSCRIPT_MAX_BYTES` = 512 KiB (`packages/files-protocol/src/index.ts:241`).
  - `sanitizeTranscript` (`workflows/aiMetadata/transcript.ts:36`) removes Whisper's hallucinated phrases. Captions don't need that, but the same empty check applies.
- Remote fetches use `safeFetch` + `pinnedFetch` + `readBodyWithLimit` (`linkMetadata/ssrf.ts`).

## Constraints And Non-goals

- Captions only. No video or audio download and no Whisper for YouTube or Vimeo.
- The whole caption fetch has a 20 s budget. Any error, timeout or empty result logs a reason (`no_captions`, `blocked`, `parse_error`, `timeout`) and continues without a transcript. It never throws or retries.
- The transcript is plain text: cues joined, auto-caption rolling duplicates collapsed, cut at 512 KiB on a word boundary.
- No backfill. The transcript decision does not ask for one, and Refresh details covers existing cards.

## Backend

- `linkMetadata/selectors.ts`: `YOUTUBE_SOURCES` (`meta[itemprop='duration']`, `link[itemprop='name']`, `meta[itemprop='uploadDate']`), added to `SCRAPE_ELEMENTS`.
- `providers/youtube.ts`: a synchronous handler producing Channel, Length (from ISO 8601) and Uploaded. Register it in `providers/index.ts` with `categories: ["tv", "movie", "course"]`.
- `workflows/steps/linkMetadata/captions/youtube.ts`:
  - It parses the video ID from `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/` and `/live/`.
  - It fetches the watch page (2 MiB cap, `Accept-Language: en`) and reads `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks`.
  - Track choice, in order:
    1. a manual track in the video's language
    2. manual English
    3. an auto (`kind: "asr"`) track in the original language
    4. auto English
  - It fetches `baseUrl&fmt=json3` (2 MiB cap) with `safeFetch`, accepting the `youtube.com` host only.
- `captions/vimeo.ts`:
  - It parses the ID (and the unlisted hash) from `vimeo.com/<id>[/<hash>]` and `player.vimeo.com/video/<id>`, and takes the hash from an `h=<hash>` query parameter on either form.
  - It calls `https://player.vimeo.com/video/<id>/config`, or `https://player.vimeo.com/video/<id>/config?h=<hash>` when a hash is present (an unlisted video's config refuses requests without it), and reads `request.text_tracks[]`, preferring captions over subtitles in the same language order.
  - It fetches the WebVTT file.
- `captions/parse.ts`: the pure functions `parseYouTubeJson3`, `parseWebVtt` and `collapseRollingCaptions`.
- `captions/index.ts fetchVideoCaptions(url): Promise<{ text, language, auto } | null>`.
- `metadata.ts` link branch:
  - For YouTube and Vimeo URLs, call `fetchVideoCaptions`.
  - On a hit, set `aiTranscript`, and append `Transcript: <text>` to the AI input, cut so the total stays within 6,000 characters.
  - The step's return value already carries `hasTranscript`.
  - Every caption-derived write is guarded by run, reusing phase 10's `cards.processingRunId` (set by `startCardProcessingWorkflow` on every run, including Refresh details) and the optional `expectedRunId` argument on `updateCardAI`. The metadata step reads the run id when it starts. It then passes `expectedRunId` to `updateCardAI` for the transcript, summary and tags. A slow caption fetch from an older run that finishes after a Refresh details is skipped with `stale_run` and never overwrites the newer run.

## Web

- No new UI. Search finds spoken phrases. The search result shows the card's normal tile.

## API / MCP / SDK / CLI

- No contract change. `aiTranscript` is already in `serializeCard`. v1 phase 13's `GET /v1/cards/:id/content`, MCP `teak_v1_get_card_content` and `teak content <id>` return it as `kind: "transcript"`. The OpenAPI description of `aiTranscript` mentions video captions.

## Docs

- `features.mdx`:
  - Smart search: "spoken words in YouTube and Vimeo videos"
  - AI enrichment table: Transcription becomes "Audio and video captions → searchable text"
  - Refresh details: it fetches captions again
- The ship month's changelog: "Search what's said in YouTube and Vimeo videos".

## UI states

- Empty: a video with no captions looks like today.
- Loading: the existing processing state. Captions add at most 20 s.
- One item / many items: not applicable.
- Very long names: a 10-hour transcript is cut at 512 KiB. Search still finds phrases in the stored part.
- Error: never shown. A failure logs a reason and completes the card.
- Rate-limited: a YouTube 429 counts as no transcript. Refresh details is limited by `cardReprocess` (6 a minute).

## Scenario seed packs

- `video-captions`, as recorded fixtures under `packages/convex/__tests__/workflows/steps/linkMetadata/fixtures/captions/`:
  - YouTube watch pages with manual English captions, with auto captions only, with no captions, with Japanese only, and with 5 languages
  - a live stream, a Short, an age-restricted page (no `captions`), and an EU consent page
  - a 10-hour json3 track (over 512 KiB)
  - Vimeo configs with tracks, without tracks, an unlisted video (`vimeo.com/<id>/<hash>` and `?h=<hash>`), and a 403 private video
- Seeded YouTube and Vimeo link cards with a prefilled `aiTranscript`, to check search in the UI.

## Break-it checklist

- UI:
  - search a phrase from minute 90
  - Refresh details twice on a video
  - a CJK transcript search
  - a card in Trash is not refreshed
- Backend:
  - a crafted video ID (`../`, `%2F`, 200 characters)
  - a caption `baseUrl` pointing to another host (refused)
  - malformed json3 and VTT
  - an empty 200 body from timedtext (the token-gated case)
  - 403, 429 and a timeout
  - a transcript over 512 KiB
  - YouTube and Vimeo URLs saved as plain text (not link cards) are ignored
  - the card completes when every caption call throws

## Tests

- `packages/convex/__tests__/workflows/steps/metadata.test.ts`: a caption fetch whose run id was superseded by a Refresh details writes nothing (`stale_run`), and the newer run's transcript stays.

- `packages/convex/__tests__/workflows/steps/linkMetadata/captions/youtube.test.ts`: ID parsing and track choice over the fixtures (network mocked).
- `.../captions/vimeo.test.ts`: config parsing, the unlisted hash from both the path and `?h=` (the config request carries `h=<hash>`), 403.
- `.../captions/parse.test.ts`: json3 and VTT tables, rolling-caption collapse, the 512 KiB cut.
- `packages/convex/__tests__/workflows/steps/metadata.test.ts`: the link branch stores `aiTranscript`, keeps the AI input within 6,000 characters, and completes when captions fail.
- `__tests__/workflows/steps/categorization/providers/providers.test.ts`: YouTube Channel, Length and Uploaded facts.
- `packages/convex/occContention.test.ts` search-sync fixtures: a transcript-only phrase is searchable.

## Proof before the PR

- Video 1: on dev, save a YouTube talk with captions, search a spoken sentence, open the card and see the summary and facts. Then a Vimeo video.
- Video 2: a video with no captions and an age-restricted one. Both complete quietly.
- Screenshots of the search hit, the YouTube facts, and the summary. Each in light and dark, at 390px and 1440px.
- Captured `GET /v1/cards/:id` showing `aiTranscript`, and the `teak content <id>` output.
- Logged caption outcomes per fixture.

## Release gate

1. Run the narrow tests above, then the repo checks.
2. Seed `video-captions`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex, then web. There is no Files Worker change and no backfill.
5. Smoke-test production: save one captioned YouTube video and search a spoken phrase. Then watch Convex logs for the caption outcome ratios for a day.

## Risks And Open Questions

- **Fragile YouTube endpoints.** The timed-text endpoints are undocumented. YouTube increasingly requires a proof-of-origin token, which shows up as empty bodies, and serves consent or bot walls to datacenter IPs. Expect a low hit rate from Convex. The step fails soft, and the outcome logs show the rate. If it is near zero, raise it with the owner before adding anything heavier.
- **Workflow rule.** This deviates from "append new steps at the end" on purpose, because the transcript must reach the summary. It adds no new step and no retry.
- **Merge with v1 phase 13.** v1 phase 13 changes the same file. Rebase on it and keep the video upload branch untouched.
