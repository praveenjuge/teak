## Goal

Transcribe podcast episode links whose page exposes a public audio file. Each episode goes through Teak's existing Whisper `process-audio` path, up to the 100 MB audio cap. Longer or unreachable episodes simply get no transcript, and the card never fails. Phase 22 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 21](2026-10-14-roadmap-v2-21-video-captions.md): the link-transcript conventions (`aiTranscript`, fail-soft outcome logging, Refresh details).
- [v1 phase 17](2026-10-12-roadmap-17-rss-feeds.md): `feeds/parse.ts parseFeed` is reused to find an episode's enclosure in its show feed.

## Success Criteria

- A podcast link whose audio is public and at most 100 MB gets `aiTranscript`, and its summary and tags are regenerated from what is said. Search finds spoken phrases.
- The audio is found, in order, from:
  1. `og:audio`
  2. JSON-LD `PodcastEpisode.associatedMedia.contentUrl`
  3. an Apple Podcasts episode through the public iTunes lookup
  4. the show's feed enclosure, found from `<link rel="alternate">` of type `application/rss+xml` or `application/atom+xml`
- Episodes over 100 MB, Spotify episodes (no public audio), dead feeds and private hosts get no transcript, and the card completes as today.
- The downloaded audio is temporary: it is deleted after transcription, and it is covered by card delete and account deletion while it exists.

## Context And Current Facts

- **Detection.**
  - `linkCategoryResolver.ts:77` maps podcasts.apple.com to podcast (provider apple).
  - `:66-74` maps open.spotify.com `/episode|/show` to podcast.
  - The path rule `\bpodcast(s)?\b|\/episode\/` (`:94`) catches the rest.
  - The JSON-LD `podcast` case (`enrichment.ts:358`) adds Duration and Series.
- **No audio hints are scraped today.** `SCRAPE_ELEMENTS` (`linkMetadata/selectors.ts`) has no `og:audio` and no RSS `link[rel=alternate]`. `STRUCTURED_DATA_FIELDS` (`enrichment.ts:10`) has no `associatedMedia` or `audio`.
- **`processAudioCard` (`workflows/mediaFacts.ts:111`).**
  - It calls Files Worker `process-audio` with a `sourceKey` that must be an R2 key in the user's namespace (`assertR2KeyInNamespace`), and `transcribe: true`.
  - It also writes `fileMetadata.duration` and `waveform` through `updateCardMediaFacts`, which is wrong for a link card. The transcription half must be split out.
  - Worker limits: `FILES_AUDIO_MAX_BYTES` = 100 MiB and `FILES_TRANSCRIPT_MAX_BYTES` = 512 KiB (`packages/files-protocol/src/index.ts:240-241`).
- **Downloads stay in Convex.** Arbitrary-domain downloads must stay in Convex with pinned DNS (`.agents/convex-costs.md:65-68`).
  - Today's downloader `storeRemoteAsset` (`fetchMetadata.ts:~200`) buffers the whole body with `readBodyWithLimit` before `storeObject`, and its caps are 20 MB for images and 50 MB for video.
  - R2 multipart ops (`create-multipart` / `complete-multipart`) exist and are used by `fileUploads.ts` and `importUpload.ts`.
- `safeFetch` re-validates every redirect hop and allows at most `MAX_REDIRECTS = 5` (`linkMetadata/ssrf.ts:49`).
- `cardStorageObjectKeys` includes `workflowArtifactKeys` (`storage/r2.ts:98`). The orphan sweep (`workflows/orphanSweep.ts`) also reads them.
- `cardProcessing.ts` ends with metadata and renderables, then telemetry. New steps go at the end (the master rule).
- Each workflow step is awaited, so the card stays in processing until the last one returns. Long follow-up work runs on its own instead: the metadata step starts the link screenshot as a separate workflow (`workflows/steps/metadata.ts:387` schedules `screenshot.startScreenshotWorkflow`).

## Constraints And Non-goals

- The transcript runs as its own workflow, `podcastTranscriptWorkflow`, after card processing completes. `cardProcessing.ts` appends one short step that only starts it, the same way `startScreenshotWorkflow` is started, and does not wait for it. So download and Whisper never keep the card in processing. It runs only for link cards categorized `podcast`, and it never fails the card. Its transcript step retries only when the worker is busy (two attempts).
- Size gate: a `Content-Length` over 100 MiB stops before downloading. A body without a length is streamed and aborted at 100 MiB. Either way, no transcript and no error.
- No new Files Worker op. Convex streams the audio into R2 in multipart parts (role `podcast-audio`) and adds the key to `workflowArtifactKeys`. After `process-audio` it deletes the object and removes the key.
- No waveform or duration is written to link cards. Audio is accepted only when its content type is `audio/*` or `video/mp4`.
- Rate limit `podcastTranscription` (20 an hour per user) in `shared/rateLimits.ts` bounds Whisper cost. Over the limit, the card gets no transcript.
- No backfill. Existing podcast cards get transcripts through Refresh details.

## Backend

- `linkMetadata/selectors.ts`: `PODCAST_SOURCES`: `meta[property='og:audio']`, `og:audio:secure_url`, `og:audio:type`, `link[rel='alternate'][type='application/rss+xml']` and `link[rel='alternate'][type='application/atom+xml']`. Add `associatedMedia` and `audio` to `STRUCTURED_DATA_FIELDS`.
- `workflows/steps/podcast/resolveEnclosure.ts`: pure resolvers plus fetches.
  - Apple: `https://itunes.apple.com/lookup?id=<showId>&entity=podcastEpisode&limit=200`, matching `trackId` to the URL's `?i=`. Use its `episodeUrl` (check this during the build).
  - Feed: the RSS or Atom feed URL from the page, through `safeFetch` (2 MiB), then `parseFeed`. Match the item by `link`, `guid` or title against the card URL, and use the enclosure URL.
  - `feeds/parse.ts parseFeed` items gain an optional `enclosureUrl`: the RSS `<enclosure url>`, or the Atom `<link rel="enclosure" href>`. Existing callers ignore it.
- `workflows/steps/podcast/downloadToR2.ts`:
  - `safeFetch` + `pinnedFetch` with a size gate.
  - The body is streamed into multipart parts of 8 MiB or more, with a running byte count.
  - Returns `{ key, contentType, bytes }` or a reason.
- `workflows/mediaFacts.ts`: split out `transcribeStoredAudio(ctx, { sourceKey, mimeType })`. It calls `process-audio` with `transcribe: true`, writes no media facts, and returns the sanitized text or null. `processAudioCard` calls it.
- `workflows/podcastTranscript.ts`: `podcastTranscriptWorkflow` (one step, `podcastTranscript`) and an internal mutation `startPodcastTranscriptWorkflow({ cardId, expectedRunId })` that calls `startWorkflow`, like `startScreenshotWorkflow`.
- `workflows/steps/podcastTranscript.ts` (internal action):
  - Load the card, resolve the enclosure, check the rate limit, download, transcribe, delete the temporary key.
  - Then `updateCardAI` with `aiTranscript`, plus a summary and tags regenerated by `generateLinkMetadata(contentParts + "Transcript: …")` within 6,000 characters.
  - The write is guarded by run, reusing phase 10's `cards.processingRunId` and `updateCardAI`'s `expectedRunId` argument. The start mutation records the run id that started it, and the step passes it as `expectedRunId`. `updateCardAI` skips the write, returning `stale_run`, when it no longer matches. A slow transcription from an older run can then never overwrite a newer run's transcript, summary, tags or processing state.
  - It logs a reason: `no_enclosure`, `too_large`, `blocked`, `rate_limited`, `no_speech` or `worker_declined`.
- `cardProcessing.ts`: append a `step.runMutation` of `startPodcastTranscriptWorkflow`, guarded by `categorization?.category === "podcast"`, with failures caught and logged. It returns as soon as the workflow is started.

## Web

- No new UI. Spoken phrases become searchable, and the summary reflects the episode.

## API / MCP / SDK / CLI

- No contract change. `aiTranscript` is already serialized. v1 phase 13's content endpoint, MCP tool and `teak content` return it as `kind: "transcript"`.

## Docs

- `features.mdx`:
  - Smart search: "what's said in podcast episodes (up to 100 MB of audio)"
  - AI enrichment: the Transcription row
- The ship month's changelog: "Search inside podcast episodes".

## UI states

- Empty: an episode without public audio looks like today.
- Loading: the card completes, and the transcript and new summary arrive a few minutes later through the normal reactive update. No spinner.
- One item / many items: not applicable.
- Very long names: a transcript over 512 KiB is cut by the worker.
- Error: never shown. Reasons are logged.
- Rate-limited: over 20 episodes an hour, cards just get no transcript. Refresh details later adds it.

## Scenario seed packs

- `podcast-transcripts`, as recorded fixtures plus a local audio server for the break-it pass:
  - episode pages with: `og:audio` (a 20 MB MP3), JSON-LD `associatedMedia` (M4A), RSS only (Atom and RSS 2.0), and an Apple Podcasts episode with an iTunes lookup fixture
  - a Spotify episode
  - a 2 GB enclosure (`Content-Length`), a 150 MB enclosure without `Content-Length`, and an MP4 video enclosure
  - silent audio, a feed returning 404, a tracking-prefix redirect chain of 6 hops, and an enclosure redirecting to `10.0.0.1`

## Break-it checklist

- UI: Refresh details during an ongoing transcription (the older run's write is skipped with `stale_run`, and only the newer run's transcript lands); delete the card mid-download (the object is removed); a CJK episode searched.
- Backend:
  - the size gate both ways
  - an abort at exactly 100 MiB
  - SSRF on the enclosure and on every redirect
  - `text/html` served as an enclosure
  - an iTunes lookup that doesn't list the episode
  - a feed of 5,000 items (2 MiB cap)
  - a worker 503, then busy (retry), then declined
  - the temporary key is deleted on success, on failure and on card hard delete
  - account deletion mid-step
  - the rate limit at 21 episodes
  - card processing completes before the transcript workflow starts its download, and stays completed when that workflow throws

## Tests

- `packages/convex/__tests__/workflows/steps/podcast/resolveEnclosure.test.ts`: the resolution order, the Apple lookup match, the RSS 2.0 and Atom item matches, including an Atom `<link rel="enclosure">` (network mocked).
- `packages/convex/__tests__/feeds/parse.test.ts`: `enclosureUrl` from an RSS 2.0 `<enclosure>` and an Atom `<link rel="enclosure">`.
- `.../podcast/downloadToR2.test.ts`: the size gates, the streamed abort, content-type refusal, the SSRF refusal (multipart and network mocked).
- `packages/convex/__tests__/workflows/steps/podcastTranscript.test.ts`: transcript and summary saved, the temporary key deleted in every outcome, the rate limit, fail-soft.
- `packages/convex/__tests__/workflows/mediaFacts.test.ts`: `transcribeStoredAudio` writes no media facts. `processAudioCard` behaves the same as before.
- `packages/convex/__tests__/workflows/cardProcessing.test.ts`: the start step is appended and runs only for podcasts. The workflow completes without waiting for the transcript, and a failure to start keeps it successful.
- `packages/convex/__tests__/workflows/podcastTranscript.test.ts`: the transcript workflow runs after card processing has completed, and a stale run id skips its write.
- `packages/convex/mediaFacts.test.ts` (convex-test): the link card's `fileMetadata` is untouched.
- `packages/convex/__tests__/storage/r2.test.ts`: a temporary key in `workflowArtifactKeys` is in `cardStorageObjectKeys`.

## Proof before the PR

- Video 1: on dev, save a public podcast episode, wait for the transcript, search a spoken phrase, and open the card to see the new summary.
- Video 2: a Spotify episode and a 2 GB episode both complete without a transcript, and R2 shows no leftover object.
- Screenshots of the search hit and the summary, in light and dark, at 390px and 1440px.
- Logged outcome reasons per fixture, the R2 listing before and after, and `GET /v1/cards/:id` with `aiTranscript`.

## Release gate

1. Run the narrow tests above, then the repo checks.
2. Seed `podcast-transcripts`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex, then web. There is no Files Worker change, provided `process-audio` takes the multipart-stored key as it is; if it does not, deploy the worker first and update `scripts/check-files-readiness.ts`. No backfill.
5. Smoke-test production on one public episode.
6. Watch Workers AI (Whisper) cost and Convex action time for a week.

## Risks And Open Questions

- **Memory and duration.** Streaming 100 MB through a Convex Node action, then up to ~1h45m of audio through Whisper, is slow. Confirm that multipart part uploads from Convex work, and that the step fits the action time limit. If not, a pinned-DNS download op in the Files Worker needs an SSRF design first (see `.agents/convex-costs.md`).
- **Redirects.** Podcast hosts often go through 3–6 tracking redirects, and the limit of 5 may drop some. Raise it for enclosures only, if the logs show it.
- **Summary input.** Regenerating the summary from the transcript follows the audio-card behavior. The owner's podcast decision only names transcription, so confirm.
- **Rights.** Teak stores only the transcript, never the audio.
