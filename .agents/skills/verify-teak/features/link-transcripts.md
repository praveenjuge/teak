# Link transcripts and video facts

Vimeo videos and podcast episodes are found by what's said in them: Teak keeps Vimeo captions, or a Whisper transcript of public episode audio, as the card's transcript, and the summary and tags describe it. YouTube links get facts under the title, but no transcript.

## Sub-features

- `transcript-vimeo` keeps a Vimeo link's captions (public, unlisted with its hash, any language) as its transcript; a private video gets none.
- `transcript-podcast` transcribes an episode link a few minutes after saving, from its page's audio, Apple Podcasts or the show's feed; Spotify episodes and episodes over 100 MB get none.
- `transcript-search` finds them by a spoken phrase, including CJK and a line near a long talk's end.
- `video-facts` shows Channel, Length and Uploaded tiles under an open YouTube card's title.
- `transcript-refresh` reads the captions or episode again on "Refresh details".

## How to get to it (user POV)

- Save a Vimeo or podcast episode link, then search a phrase from it in "Search everything", or open the card.
- The card's "More" menu or a right-click: "Refresh details".

## Driving it with e2e MCP

Preconditions:

- Seed both packs on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"video-captions"}'`
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"podcast-transcripts"}'`
- A real save needs the deployed dev Core Worker with its link-fetch and media Containers. The local E2E stack has none (no Docker), so live links fail there by design; its Whisper is fake.

Steps:

- **Spoken phrase.** `press` "/" and `type` "hermit crab": "Episode 42: Tide pools" is listed. `type` "velvet harbor theorem" with `replace: true`: "A two-hour Vimeo lecture" is listed (the phrase is at its end).
- **CJK.** `type` "こんにちは" with `replace: true`: "A Vimeo video with Japanese captions" is listed.
- **No transcript.** `type` "#scenario-podcast-transcripts" and open "A Spotify episode (no public audio)": no transcript-based summary, and another episode's phrase doesn't list it.
- **YouTube facts.** "A YouTube talk with channel, length and date" shows tiles "Channel Example Channel", "Length 1h 2m 3s" and "Uploaded Sep 14, 2026" under its title.
- **Live save (Vimeo).** Save `https://vimeo.com/76979871`; once finished, "how to make your videos" finds it. `GET /v1/cards/<id>` has `aiTranscript`, and `bun apps/cli/src/index.ts content <id>` prints it with `kind: "transcript"`.
- **Live save (podcast).** Save an Apple Podcasts episode URL (`…/id<show>?i=<episode>`). The card completes at once; within a few minutes `aiTranscript` appears and the summary changes. Worker logs show `podcast transcript` with `transcribed: true`, or a reason (`no_enclosure`, `too_large`, `rate_limited`, `no_speech`, …).

## Gotchas

- YouTube serves no captions to servers (they need a proof-of-origin token), so YouTube links never get a transcript.
- A podcast transcript arrives after the card looks finished, with no spinner; wait, then reload or search again.
- Without a domain rule, a page under `/episodes/<slug>` counts as a podcast episode only with its own audio (`og:audio`); otherwise it falls back to TV and isn't transcribed. Domain-rule sites (Apple Podcasts, say) keep their category. Seeded episodes use `/podcast/` paths.
- Keyword search splits at spaces and punctuation, so a long CJK run is one unmatched word; a short one like "こんにちは" matches.
- Dev also searches by meaning: it may still find long CJK phrases, and may list related seeded cards; judge by the expected card being present.
- 20 episodes an hour per account are transcribed; past that a card gets none until a later "Refresh details".
