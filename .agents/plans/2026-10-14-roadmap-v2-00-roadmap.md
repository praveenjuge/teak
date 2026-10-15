## Goal

Make Teak better at saving, finding and rediscovering things, as 31 separate plans. Each phase is one PR (phase 9 may be folded into another), deployed and verified in production on its own before the next one starts. It follows the v1 roadmap, which finished on 2026-10-15: phases 1–13 and 19 shipped, and phases 14–18 (reader view, stats, rules, RSS feeds, public share links) were dropped. Its plans were deleted; git history keeps them.

## Success Criteria

- Every phase below merges as its own PR, except phase 9, which may be folded into another PR (see Risks). Each PR has:
  - green CI
  - a break-it pass over its mock data packs
  - a proof bundle (videos plus screenshots) sent to the owner before the PR opens
  - a production smoke test after it merges
- No phase breaks a shipped client. The native iPhone, iPad, Mac and Android apps keep working against the new backend without an update.
- Every new feature works on the web and through the public API, MCP, SDK and CLI where it applies, and is free on all plans. The free 200-card cap is still the only limit.
- `apps/docs` documents each feature in the month it ships. Once search ships (phase 14), the homepage calls out the new search features.

## Context And Current Facts

- On 2026-10-14 the owner reviewed a list of candidate features against Teak's current code and picked the ones in this roadmap through a Q&A.
- Local `main` was at `cbc71d2` (v1 phase 10, Shuffle) when this roadmap was written.
- Verified facts several phases rely on:
  - **Search:**
    - Search runs on one Convex full-text index, `cardSearchDocuments.search_searchableText`. Its filter fields are userId, isDeleted, isArchived, type, isFavorited and urlHost.
    - The index text is built by `buildCardSearchText` from `SEARCH_FIELDS` in `packages/convex/card/searchDocumentHelpers.ts`.
    - There is no vector search or Vectorize binding anywhere.
    - Queries read at most 400–1024 candidates, then sort them by `createdAt` or shuffle them (`shared/search/sort.ts`, `shared/search/shuffle.ts`).
  - **Qualifiers:** `parseSearchQuery` in `packages/convex/shared/search/qualifiers.ts` parses them, and `packages/convex/card/searchPlanner.ts` resolves them.
  - **AI models:** everything runs on Workers AI in `apps/files-worker`:
    - vision: Gemma 4 26B (`src/imageMetadata.ts`)
    - text: Qwen3 30B (`packages/files-protocol/src/metadata.ts`)
    - speech: Whisper large-v3-turbo
  - **Worker calls:** Convex calls the worker through `callFilesWorkerJson` (`packages/convex/storage/filesWorkerClient.ts`) with HMAC-signed `{op, params, version}` requests. The ops are listed in `FILES_OPS` (`packages/files-protocol/src/index.ts`) and dispatched in `apps/files-worker/src/ops.ts`.
  - **Document text** is extracted by `extractFileTextForAiForKey` (`workflows/fileProcessing.ts`). It is cut to 6,000 characters for the AI and then thrown away. v1 phase 13 starts keeping it.
  - **Audio transcripts** are stored in `cards.aiTranscript` and are already searchable.
  - **Link categories:** 15 categories in `shared/linkCategories.ts`, plus site-specific providers in `workflows/steps/categorization/providers/` (Amazon, Dribbble, GitHub, Goodreads, IMDb). Products and recipes also get JSON-LD enrichment (`enrichment.ts`).
    - Prices are display strings inside `facts`.
    - YouTube is classified as `tv` and has no enrichment handler.
  - **Extension** (`apps/extension`, WXT):
    - The popup auto-saves the page.
    - Right-click → Save Text sends `{content, cardType: "text"}` and **drops the page URL**.
    - The Firefox build is already configured (gecko id, `build:firefox`, its own OAuth client).
    - There is no omnibox entry.
  - **Command palette:** none exists. There is no `cmdk` dependency and no `command.tsx`. ⌘K inserts a link inside the text editor (`text-editor/EditorControls.tsx:65`).
  - **Editor:** the rich editor is Tiptap with editorcn (`packages/ui/src/components/text-editor`). Task lists already work, there is no `[[` support, and the slash menu (`SlashMenu.tsx`) is the pattern to copy. Only new notes can open full screen (`forms/FullScreenAddCardDialog.tsx`).
  - **Tags** are strings on `cards.tags` / `cards.aiTags` and are matched case-insensitively through `tagKey` (`shared/tags.ts`). There is no tag that hides a card.
  - **Sort menu:** the header's view menu (`packages/ui/src/components/search/ViewMenu.tsx`) offers Newest first, Oldest first and Shuffle. The URL state lives in `packages/ui/src/lib/searchUrlState.ts`.
  - **No email provider.** WorkOS sends sign-in email; Teak sends and receives none itself. `http.ts` checks webhook signatures in `workosWebhook.ts`, which is the template for new inbound routes.
  - **Backfills** are hand-written, self-scheduling paged mutations with `dryRun` defaulting to true, for example `packages/convex/migration/backfillUrlHost.ts`.

## Decisions (from the Q&A, apply to every phase)

| Topic | Decision |
|---|---|
| Relation to v1 | v1 finished on 2026-10-15. Its phases 14–18 (reader view, stats, rules, RSS feeds, public share links) were dropped, not deferred |
| Surfaces | Backend, web, public API, MCP, SDK and CLI in the same PR. Apple, Raycast and Android come in phases 29–31 |
| PR size | One feature per PR; a large feature is split into consecutive phases |
| Feature flags | None. Each feature ships live when it merges |
| Pricing | Every feature on every plan. No middle tier and no AI credits |
| Compatibility | Convex changes stay backward compatible: new args are optional, and unknown enum values are tolerated by every client |
| Backfills | Approved. Dry run first, then paged internal mutations under `packages/convex/migration/` |
| Docs | Each phase updates `features.mdx` and the month's changelog, plus the API, MCP and CLI docs when it touches them |
| Semantic search | Cloudflare Vectorize with `@cf/baai/bge-m3` (1024 dimensions). One vector per card, filtered by a `userId` metadata index (per-user namespaces would hit Vectorize's 50,000-namespace cap). Results are blended into normal search everywhere with reciprocal rank fusion, then the chosen sort is applied |
| Similarity | `like:<cardId>`, a "More like this" button, `mood:"…"` for images, and `similarTo` in the API. It covers every card type |
| OCR | Comes from the same Gemma vision call, for images, video thumbnails, link screenshots and scanned PDFs. Searchable through plain search and `text:`. Backfilled |
| Transcripts | YouTube and Vimeo use their own caption tracks (never a video download). Podcasts are transcribed with Whisper up to the 100 MB audio cap. Uploaded videos are covered by v1 phase 13 |
| Hidden cards | User tags `private`, `nsfw` and `hidden` hide a card from the grid, search, Shuffle and Revisit, folders, smart folders and the API, MCP and CLI. Searching that tag is the only way to show them. AI tags never hide anything |
| Revisit | A fourth entry in the sort menu: 20 random cards from the current view, ← archives, → keeps |
| Email-in | Cloudflare Email Routing to an Email Worker. Personal address `save+<token>@in.teakvault.com`. Smart split into cards, every card tagged `email`, emails over the free limit silently dropped |
| Not doing | A reader mode (v1-14 was dropped too), library chat, X sync, PWA share target, pinned cards strip, rediscover email, privacy-promise pages, offline library, webhooks, achievements, labs page, reader themes, pinned sites, date-grouped list, highlights, new importers, sending page HTML from the extension, "gather dust", tidy-up, Notion sync, GitHub stars, comparison pages, MCP progressive reads, command palette recents |

## Rules every phase follows

The rules in `.agents/feature-conventions.md` apply to every phase. In short:
- Search-affecting writes go through `patchCardWithSearchSync`.
- New boolean flags are `v.optional(v.literal(true))`.
- New indexes are added next to the old ones.
- New workflow steps are appended at the end of `workflows/cardProcessing.ts`.
- New user tables, card rows and R2 keys are covered by account deletion, card hard delete and `cardStorageObjectKeys`.
- New public API features follow the usual order, from `publicApi*.ts` through to the CLI.
- Files Worker changes deploy before Convex and web.
- Analytics events are added to `packages/convex/shared/analytics.ts` first.

## UI bar for every phase: polished, minimal, classy

Same as v1:
- shadcn new-york primitives and `lucide-react` icons
- one primary action per surface
- quiet empty states
- 150–200ms easing
- skeletons, not spinners
- sentence-case copy
- optimistic updates with undo toasts
- keyboard reachable
- correct in light and dark, at 390px, 768px and 1440px

Before coding, sketch every state: empty, loading, one item, many items, very long names, error, rate-limited.

## Break it and proof, every phase

Each phase file has its own **Scenario seed packs**, **Break-it checklist** and **Proof before the PR** sections. Common to all of them:

- **Mock data.** Add the phase's packs to `devSeed.seedScenario({ workosUserId, scenario })` in `packages/convex/devSeed.ts`. It uses the same dev-only guard as `devSeed.seed`, and pages its writes.
  - Every phase also loads the v1 volume and ugly-data packs: 1,000+ cards of all 8 types; 300-character, emoji, RTL, CJK and empty titles; tags that differ only by case; broken link metadata; huge files.
- **Break the UI.** Use the `e2e` MCP against `bun run dev --detach`, with every pack, and try:
  - double clicks
  - back and forward through the history
  - reload mid-action
  - two tabs at once
  - a slow connection, then offline and reconnect
  - rate limits
  - keyboard only
  - 390px, 768px and 1440px widths
  - light and dark themes

  Every bug found gets a regression test and a fix before the PR.
- **Break the backend.** Table-driven and fuzz tests over parsers. Convex tests for:
  - caps and limits
  - ownership (another user's IDs)
  - trashed, archived and hidden states
  - idempotent retries
  - OCC (`packages/convex/occContention.test.ts`)

  Also send bad input, bad cursors and missing auth to the API, MCP and CLI.
- **Proof sent to the owner before the PR opens.** Saved in the session scratchpad and sent with SendUserFile:
  - one **video** per new flow (the happy path plus the nastiest edge case), recorded with the e2e `start_recording` / `stop_recording`
  - **screenshots** of every state, in light and dark, at 390px and 1440px
  - a short list of what broke and how it was fixed
  - captured requests and responses, or terminal output, for API, MCP and CLI changes

  The PR body links to or summarises the same proof.

## Release gate for every phase

1. Run the narrowest tests, then the repo checks:
   - `bun run lint`
   - `bun run typecheck`
   - `bun run --cwd packages/convex test:unit` and `test:edge`
   - `bun run --cwd packages/ui test`
   - `bun run --cwd apps/web test`
   - the relevant `packages/tests` e2e specs (`bunx e2e run`)

   Break the code on purpose and confirm each new test fails.
2. Seed the phase's packs, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. CI must be green and the PR mergeable. Then merge and deploy (the Files Worker or Email Worker first when touched). Run any backfill as a dry run first, then in pages. Smoke-test production. Only then start the next phase.

## Phases

Each phase is its own plan and its own PR. "v1-N" means phase N of the v1 roadmap. v1 phase 19 (Hardening) shipped on 2026-10-15, so any phase can start.

| # | Plan | Group | Depends on |
|---|---|---|---|
| 1 | [Command palette (⌘K)](2026-10-14-roadmap-v2-01-command-palette.md) | Quick wins | — |
| 2 | [Focus mode for text cards](2026-10-14-roadmap-v2-02-focus-mode.md) | Quick wins | — |
| 3 | [Ticked checklist items move down](2026-10-14-roadmap-v2-03-checklist-sort.md) | Quick wins | — |
| 4 | [Hidden cards via reserved tags](2026-10-14-roadmap-v2-04-hidden-cards.md) | Quick wins | — |
| 5 | [Revisit view](2026-10-14-roadmap-v2-05-revisit.md) | Quick wins | 4 |
| 6 | [Extension: tags and note after saving, source for Save Text](2026-10-14-roadmap-v2-06-extension-save-details.md) | Quick wins | — |
| 7 | [Extension address-bar search](2026-10-14-roadmap-v2-07-extension-omnibox.md) | Quick wins | 4 |
| 8 | [Firefox release](2026-10-14-roadmap-v2-08-firefox-release.md) | Quick wins | 6, 7 |
| 9 | [Agent-skill discovery address (mostly shipped; lock it in)](2026-10-14-roadmap-v2-09-agent-skill-index.md) | Quick wins | — |
| 10 | [OCR: images and video thumbnails](2026-10-14-roadmap-v2-10-ocr-images.md) | Search & AI | — |
| 11 | [OCR: link screenshots and scanned PDFs](2026-10-14-roadmap-v2-11-ocr-screenshots-pdfs.md) | Search & AI | 10, v1-13 |
| 12 | [Embedding infrastructure](2026-10-14-roadmap-v2-12-embeddings.md) | Search & AI | 10, v1-13 |
| 13 | [Blended search everywhere](2026-10-14-roadmap-v2-13-hybrid-search.md) | Search & AI | 12, 4 |
| 14 | [More like this, `like:` and `mood:`](2026-10-14-roadmap-v2-14-similar-and-mood.md) | Search & AI | 13 |
| 15 | [Read, watch and buy states](2026-10-14-roadmap-v2-15-done-states.md) | Smarter cards | — |
| 16 | [Structured price](2026-10-14-roadmap-v2-16-structured-price.md) | Smarter cards | — |
| 17 | [Replace a link card's thumbnail](2026-10-14-roadmap-v2-17-replace-thumbnail.md) | Smarter cards | — |
| 18 | [New link categories](2026-10-14-roadmap-v2-18-new-categories.md) | Smarter cards | 15 |
| 19 | [Fetchers for social posts](2026-10-14-roadmap-v2-19-social-posts.md) | Smarter cards | 18 |
| 20 | [Richer details for more sites](2026-10-14-roadmap-v2-20-rich-sites.md) | Smarter cards | 18 |
| 21 | [YouTube and Vimeo transcripts](2026-10-14-roadmap-v2-21-video-captions.md) | Smarter cards | v1-13 |
| 22 | [Podcast transcripts](2026-10-14-roadmap-v2-22-podcast-transcripts.md) | Smarter cards | 21 |
| 23 | [Save by email](2026-10-14-roadmap-v2-23-email-in.md) | Capture | — |
| 24 | [Email attachments](2026-10-14-roadmap-v2-24-email-attachments.md) | Capture | 23 |
| 25 | [More kinds of feeds: YouTube channels, autodiscovery, OPML](2026-10-14-roadmap-v2-25-feed-extras.md) | Capture | v1-17 (dropped; see Risks) |
| 26 | [`[[` links between cards](2026-10-14-roadmap-v2-26-card-links.md) | Writing | — |
| 27 | [Backlinks panel and links API](2026-10-14-roadmap-v2-27-backlinks-api.md) | Writing | 26 |
| 28 | [Pages for specific audiences](2026-10-14-roadmap-v2-28-audience-pages.md) | Docs site | 14 |
| 29 | [Apple follow-up](2026-10-14-roadmap-v2-29-apple.md) | Native | 4, 5, 6, 10, 14, 15, 26 |
| 30 | [Raycast follow-up](2026-10-14-roadmap-v2-30-raycast.md) | Native | 14, 15 |
| 31 | [Android follow-up](2026-10-14-roadmap-v2-31-android.md) | Native | 29 |

**Why this order.** The owner chose quick wins first, so small user-visible web and extension features with little or no schema risk come first (1–9).
- Search and AI comes next (10–14). OCR text and v1 phase 13's stored text both feed the embeddings, so they ship before them, and blended search and similarity come after.
- Then come the smarter-card features (15–22), the capture features (23–25), writing (26–27) and the audience pages (28). The audience pages wait until there are search features to show.
- The native follow-ups (29–31) come last, once the backend shape is settled.

## Risks And Open Questions

- **RSS feeds were dropped.** Phase 25 extends v1 phase 17's feeds, and phase 22 reuses its feed parser to find a podcast episode's audio. v1 phase 17 was never built, so phase 25 needs feeds built first (or a new scope), and phase 22 needs its own feed parsing.
- **Native apps and blended search.** `searchMobileCardSummariesPaginated` is a reactive query and cannot call the worker. So the iPhone, iPad, Mac and Android apps get semantic results only once they call the new search action (phases 29 and 31). Raycast already searches through `GET /v1/cards`, so it gets blending from phase 13.
- **Phase 9 has mostly shipped.** The docs site already serves `/.well-known/agent-skills/index.json` with its digest, and the API domain redirects to it. Phase 9 is now only checks and a build guard, and can be folded into another PR.
- **Search speed and cost.** Blended search adds a Workers AI embedding call and a Vectorize query to every search. Measure p95 latency and cost on the dev deployment before phase 13 merges. Keep keyword results reactive, and merge the semantic results in as they arrive.
- **Vectorize consistency.** Vectorize is a second store. Card hard delete and account deletion must remove vectors, and a periodic orphan sweep should compare vector IDs against cards.
- **Native category handling.** Phase 18 adds new link categories. Apple (`Card.swift`) and Android (`Card.kt`) already decode the category as a plain string, so no client update has to ship first. Phase 18 adds Swift and Kotlin tests to keep it that way.
- **YouTube captions.** The timed-text endpoints are undocumented and can change, so the transcript step must fail soft.
- **Email-in abuse.** A leaked address lets anyone fill a library. The token can be regenerated, rate limits are per address and per sender, and the free-plan cap still applies.
- **Index rebuilds.** New `cards` and `cardSearchDocuments` indexes (phases 4 and 10) backfill on deploy. Phase 15 uses card-level filters and adds an index only if measurements require one. Deploy them in low-traffic windows and watch Convex database I/O (`.agents/convex-costs.md`).

## Open decisions for the owner

The phase plans flagged these choices. Each one is written up in its phase file, with a default to use until the owner decides.

| Phase | Decision | Default in the plan |
|---|---|---|
| 5 | Is Revisit offered in Archive and Trash? | No |
| 6 | Field names next to the existing `source` key in `POST /v1/cards` | `sourceUrl`, `sourceTitle` |
| 11 | Should OCR also read the link's `og:image`? The page screenshot is taken with network blocked, so images and fonts don't render | Ask before building |
| 15 | `POST`/`DELETE /done`, or `PATCH` like favorite? | `POST`/`DELETE` |
| 17 | HEIC replacement thumbnails, if `finalize-image-upload` can't decode them | Refuse HEIC |
| 22 | Should a podcast transcript also regenerate the summary? | Yes, as for YouTube |
| 27 | `links`/`backlinks` only on single-card responses, not on `/v1/cards/changes` | Single-card only |

### Decided

| Phase | Decision |
|---|---|
| 2 | The composer's full-screen note and Focus mode become one feature, on ⌘E, for new and existing notes |
| 4 | No announcement for cards that already carry `private`, `nsfw` or `hidden`; the normal changelog entry covers it |
| 12 | The privacy policy wording in the phase 12 plan is approved and ships in that PR |
| 15 | Done states are for link cards only |
| 23 | Add `INBOUND_ADDRESS_SECRET` and derive each address token from it, so Settings can show the address again while only its hash is stored. Mail arrives through Cloudflare Email Routing |
