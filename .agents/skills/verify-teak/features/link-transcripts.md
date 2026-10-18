# Link transcripts and video facts

A user finds a Vimeo video or a podcast episode by something said in it: Teak keeps a Vimeo video's captions, and the Whisper transcript of an episode whose audio is public, as the link card's transcript, and its summary and tags describe what's said. YouTube links show the channel, length and upload date in Details, but no transcript.

## Sub-features

- `transcript-vimeo` keeps a Vimeo link's captions (public, unlisted with its hash, any language) as its transcript; a private video gets none.
- `transcript-podcast` transcribes a podcast episode link a few minutes after it's saved, from its page's audio, Apple Podcasts or the show's feed; Spotify episodes and episodes over 100 MB get none.
- `transcript-search` finds those cards by a spoken phrase, including CJK and a line near the end of a long talk.
- `video-facts` shows Channel, Length and Uploaded for a YouTube link in Details.
- `transcript-refresh` reads the captions or the episode again on "Refresh details".

## How to get to it (user POV)

- Save a Vimeo or podcast episode link with the composer, then search a phrase from it in "Search everything".
- Open the card: its summary describes what's said; "Details" lists a YouTube link's facts.
- The card's "More" menu or a right-click: "Refresh details".

## Driving it with e2e MCP

Preconditions:

- Seed both packs on the signed-in account: `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"video-captions"}'`, then `"scenario":"podcast-transcripts"` (local stack), or the same `devSeed:seedScenario` call on the dev deployment.
- A real save needs the Files Worker that has this feature (local stack, or dev once deployed) and, for podcasts, Workers AI.

Steps:

- **Spoken phrase.** `press` "/" and `type` "hermit crab". The card "Episode 42: Tide pools" is listed. Then `type` "velvet harbor theorem" with `replace: true`: "A two-hour Vimeo lecture" is listed (the phrase is at its end).
- **CJK.** `type` "富士山の朝焼け" with `replace: true`: "A Vimeo video with Japanese captions" is listed.
- **No transcript.** `type` "#scenario-podcast-transcripts". Open "A Spotify episode (no public audio)": its dialog has no transcript-based summary, and searching a phrase from another episode doesn't list it.
- **YouTube facts.** Open "A YouTube talk with channel, length and date" and `tap` "Details": Channel "Example Channel", Length "1h 2m", Uploaded "Sep 14, 2026".
- **Live save (Vimeo).** Save `https://vimeo.com/76979871` with the composer and wait for the card to finish. Search a line from its captions ("how to make your videos"): the card is listed. Proof through the API: `GET /v1/cards/<id>` has `aiTranscript`, and `bun apps/cli/src/index.ts content <id>` prints it with `kind: "transcript"`.
- **Live save (podcast).** Save an Apple Podcasts episode URL (`…/id<show>?i=<episode>`). The card completes at once; within a few minutes `aiTranscript` appears and the summary changes. Worker logs show `podcast transcript` with `transcribed: true`, or a reason (`no_enclosure`, `too_large`, `rate_limited`, `no_speech`, …).

## Gotchas

- YouTube serves no captions to servers (they need a proof-of-origin token), so a YouTube link never gets a transcript; that's expected.
- A podcast transcript arrives after the card looks finished: no spinner shows while the episode downloads and Whisper runs. Wait, then reload or search again.
- Pages under `/episodes/<slug>` are categorized as TV by a site rule and are not transcribed; seeded episodes use `/podcast/` paths.
- The dev deployment searches by meaning too, so a phrase can also list related seeded cards; judge by the expected card being present.
- 20 episodes an hour per account are transcribed; past that a card gets no transcript until "Refresh details" later.
