## Goal

Close the most useful gaps between Teak and three comparable save-everything apps, as 10 phases. Each phase is one PR (phase 2 is the one exception: its plan splits it into a schema-and-backfill PR and a behaviour PR, plus the usual later PR that drops replaced indexes), deployed and verified in production before the next one starts. It follows roadmap v2, which closed on 2026-10-18 (#760): phases 1–24 and 26–28 shipped, and phases 25 (feed extras) and 29–31 (Apple, Raycast and Android follow-ups) were skipped.

The roadmap first had 18 phases. On 2026-10-23 the owner dropped four (folder export, folder suggestions with Clef, tag cleanup, and removing an image's background) and merged phases that fit in one PR: the URL key, re-saving and pasting links became phase 2; the page archive and the dead-link fallback became phase 6; the localization foundation and the seven languages became phase 9. The phases were renumbered 1–10.

## Success Criteria

- Each phase merges as its own PR (phase 2 as two, see its plan), and each PR has:
  - green CI;
  - a break-it pass over its seed packs;
  - a proof bundle (videos and screenshots) sent to the owner before the PR opens;
  - a production smoke test after it merges.
- No phase breaks a shipped client. The native iPhone, iPad, Mac and Android apps keep working against the new backend without an update.
- Every new feature works on the web, and through the public API, MCP, SDK and CLI where it applies. It is free on every plan; the 200-card free cap stays the only limit.
- `apps/docs` documents each feature in the month it ships.

## Context And Current Facts

- On 2026-10-17 a research pass read the full docs, help centers, changelogs and pricing pages of three comparable save-everything apps. It compared them with Teak's code and docs and produced a list of features the competitors have and Teak doesn't.
- On 2026-10-19 the owner chose features from that list in a Q&A. The answers are the decisions below.
- Local `main` was at `2f95762` (#765) when this roadmap was written.
- Facts several phases rely on (each phase plan lists its own):
  - **Duplicate check:**
    - `card/findDuplicateCard.ts` matches the exact `cards.url` string on `by_user_url_deleted`.
    - The duplicate check is called by the Chrome and Firefox extension and Raycast (through `GET /v1/cards/duplicate`), the Safari extension (the Convex `findDuplicateCard` query), and explicitly through the public API, MCP `teak_v1_check_duplicate_url`, the SDK and `teak cards duplicate`. `createCard`, `POST /v1/cards`, the bulk API, the web composer and the native share sheets always insert.
    - Imports skip existing URLs (`DUPLICATE_URL`).
  - **Grid order:** "Newest first" sorts by `createdAt` (`shared/search/sort.ts`), which is set once and never bumped.
  - **Search:**
    - `shared/search/qualifiers.ts` `parseSearchQuery` has no negation and no OR.
    - `card/searchPlanner.ts` resolves the parsed query.
    - Semantic results are blended in with reciprocal rank fusion (`shared/search/semantic.ts`).
    - The embedding model is EmbeddingGemma (768 dimensions, 512 input tokens), in sharded Vectorize indexes (`.agents/semantic-search.md`).
  - **Link processing** (`apps/files-worker/src/workflows/cardProcessing/run.ts`):
    - It fetches the page HTML (kept up to 24 hours in the `LINK_PAGE_CACHE` KV namespace when the binding exists and the fetcher marks the page cacheable), scrapes the metadata, renders a screenshot with Browser Rendering, and reads text from the link images.
    - Apart from that transient cache, the HTML and article text are never stored with the card.
  - **Import:** `shared/importSources.ts` lists 10 sources. OneTab already parses one URL per line, and `import/csv.ts` parses RFC 4180 CSV.
  - **Note editor:** Tiptap with editorcn. Markdown tables are kept as literal Markdown blocks; no table extension and no table rendering exist anywhere.
  - **Localization:**
    - No i18n library or string catalog exists. The web has about 340 JSX text lines and 57 toasts.
    - `"en-US"` is hardcoded in about 7 formatters.
    - The AI prompts don't set a language.
  - **Legal:** the privacy policy and terms state what Teak collects. Phase 1 (badge URL checks) and phase 6 (the archive and its extension HTML capture) change what is collected, so those PRs update them.

## Decisions (from the 2026-10-19 Q&A, apply to every phase)

| Topic | Decision |
|---|---|
| Relation to v2 | v3 is a new roadmap. v2 is closed |
| Order | Quick wins first (phases 1–5), then archive, reader and highlights (6–8), then localization (9–10) |
| Surfaces | Backend, web, public API, MCP, SDK and CLI ship in the same PR where they apply. The native apps get no new UI in v3 and must keep working |
| Pricing | Every feature on every plan |
| Process | Same as v2: one PR per phase, seed packs, a break-it pass, proof sent to the owner before the PR, a production smoke test |
| Extension shortcut | Alt+Shift+S (⌥⇧S) saves the page silently. The icon flashes a check and the badge turns on. No popup |
| Saved badge | Checks the URL with Teak when a tab is activated or loaded, with a short cache. Visited URLs go to Teak, so the privacy policy says so |
| URL matching | One normalized URL key (scheme, `www`, trailing slash, fragment, `utm_*`/`fbclid`/`gclid`). The stored `url` stays as saved |
| Re-saving | A new `savedAt` sort key: "Newest first" sorts by it, and `createdAt` stays the first-save date. Re-saving un-archives the card. It does not merge tags or notes, and does not restore from Trash (a trashed match is ignored). Applies to every interactive and API save through one server rule; imports are the exception and never bump (phase 2) |
| Pasting links | Text where every non-empty line is a URL always becomes one link card per line. Up to 100 per paste, queued past the 30-per-minute rate limit, stopping at the free cap. Repeats use the re-save rule |
| Tables | GFM tables: `/table` inserts a 3×3 table with a header row, Tab moves between cells, and a hover menu adds and removes rows and columns. Rendered in previews; tiles show plain text. Native apps show raw text for now |
| Search operators | `-word`, `-"phrase"`, `-qualifier` (`-tag:`, `-#`, `-type:`, `-site:`, `-folder:`, `-is:`), uppercase `OR` and parentheses. Filters apply after semantic blending. Taught through search suggestions and the docs or `?` sheet |
| CSV import | A generic CSV source recognizing the headers url, title, tags, folder, note/notes and created (plus aliases), with no mapping UI. Folders are flattened as today. OneTab's parser becomes a labeled "Text file of links" source, with OneTab kept as an alias |
| Archive | A single-file HTML snapshot of every link, made automatically on save on every plan, and backfilled for existing links. Cap 20 MB: media is dropped first, and past the cap the archive is text-only. When saving from the extension, the extension sends the page's rendered HTML (this reverses v2's "not doing") |
| Reader | A "Read" tab in the link card modal. One typographic default that follows light and dark, with no controls. The article text is searchable by keyword and by meaning. API, MCP, SDK and CLI can read the article text as Markdown; the HTML snapshot stays in the app. Native apps later |
| Dead links | When you open a link, a quick server check runs. On a 404, 410 or a dead domain, Teak opens the archived copy with a quiet "Archived copy" label. No background crawling |
| Highlights | Made in Teak's reader only. Stored as their own record (card, quote, anchor, optional note), in one color. Shown in the card's side panel; clicking one jumps to it. Once a card has highlights its archive is frozen, and Refresh details never replaces its article text. Instapaper, Omnivore and Readwise imports create real highlights. API, MCP, SDK and CLI can read and write them |
| Localization | Web app and browser extension only. Languages: Spanish, Portuguese (Brazil), German, French, Japanese, Korean and Chinese. The language is chosen in Settings → Language (default English), with no locale in URLs. AI-translated catalogs, spot-checked by the owner, and CI fails on missing keys. Search syntax stays English. The library is chosen in phase 9. AI summaries and tags follow the language of the saved content |
| Not doing (v3) | Folder export, folder suggestions, tag cleanup and background removal (dropped on 2026-10-23), public share links (dropped again during this Q&A), collaboration, library chat, webhooks, Zapier/IFTTT/Make, reminders, broken-link checker, duplicate finder, nested folders, folder icons, per-folder layouts, automatic backups, scoped API keys, 2FA settings, Windows app, Spotlight, highlights on live pages or PDFs, reader controls, native reader, localized native apps and docs |

## Rules every phase follows

`.agents/feature-conventions.md` applies, as in v2:
- Search-affecting writes go through `patchCardWithSearchSync`.
- New boolean flags are `v.optional(v.literal(true))`.
- New indexes are added next to the old ones.
- New workflow steps are appended at the end of `run.ts`, and each one passes the `guard`.
- New tables, card rows and R2 keys are covered by account deletion, card hard delete and `cardStorageObjectKeys`.
- New public API operations go from `publicApi*.ts` through to the CLI and the `scripts/public-parity.ts` row.
- Files Worker changes deploy before Convex and web.
- Analytics events go in `shared/analytics.ts` first.
- Backfills are dry-run-first paged mutations under `packages/convex/migration/`, and production runs are the owner's.

## UI bar for every phase: polished, minimal, classy

Same as v2:
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

Every phase plan has a **Scenario seed packs**, a **Break-it checklist** and a **Proof before the PR** section.

- **Mock data:** add the phase's packs to `devSeed.seedScenario`. Every phase also loads the volume and ugly-data packs:
  - 1,000+ cards of all 8 types;
  - 300-character, emoji, RTL, CJK and empty titles;
  - tags that differ only by case;
  - broken link metadata;
  - huge files.
- **Break the UI:** use the `e2e` MCP against `bun run dev --detach` and try:
  - double clicks, back and forward, and reloading mid-action;
  - two tabs at once;
  - a slow connection, then offline and reconnect;
  - rate limits and keyboard only;
  - 390, 768 and 1440 px, in light and dark.

  Every bug found gets a regression test and a fix.
- **Break the backend:**
  - table-driven and fuzz tests over parsers;
  - Convex tests for caps, ownership, trashed/archived/hidden states, idempotent retries and OCC;
  - bad input, bad cursors and missing auth against the API, MCP and CLI.
- **Proof:** follow the `verify-teak` skill. Videos of each new flow and its nastiest edge case, plus screenshots of every state. Save them in the session scratchpad and send them to the owner with SendUserFile before the PR opens.

## Release gate for every phase

1. Run the narrowest tests, then the repo checks:
   - `bun run lint`
   - `bun run typecheck`
   - `bun run --cwd packages/convex test:unit`
   - `bun run --cwd packages/convex test:edge`
   - `bun run --cwd apps/web test`
   - the phase's `packages/tests` e2e specs

   Break the code on purpose and confirm each new test fails.
2. Seed the packs, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Open the PR. When CI is green, merge and deploy, with the Files Worker first when it is touched. Run any backfill as a dry run first, then in pages. Smoke-test production before the next phase starts.

## Phases

| # | Plan | Group | Depends on |
|---|---|---|---|
| 1 | [Extension save shortcut and saved badge](2026-10-19-roadmap-v3-01-extension-shortcut-badge.md) | Quick wins | — |
| 2 | [URL key, re-saving and pasting links](2026-10-19-roadmap-v3-02-url-key-resave-paste.md) (two PRs) | Quick wins | — |
| 3 | [Tables in notes](2026-10-19-roadmap-v3-03-note-tables.md) | Quick wins | — |
| 4 | [Exclude, OR and grouping in search](2026-10-19-roadmap-v3-04-search-operators.md) | Quick wins | — |
| 5 | [CSV and text-file-of-links import](2026-10-19-roadmap-v3-05-csv-import.md) | Quick wins | 2 |
| 6 | [Page archive and dead-link fallback](2026-10-19-roadmap-v3-06-page-archive.md) | Archive & reading | 2 |
| 7 | [Reader view and article search](2026-10-19-roadmap-v3-07-reader-view.md) | Archive & reading | 6 |
| 8 | [Highlights](2026-10-19-roadmap-v3-08-highlights.md) | Archive & reading | 7 |
| 9 | [Localization: foundation and seven languages](2026-10-19-roadmap-v3-09-localization.md) | Localization | — |
| 10 | [AI output in the content's language](2026-10-19-roadmap-v3-10-ai-content-language.md) | Localization | — |

**Why this order.**
- The owner chose quick wins first.
- Phase 2's URL key comes before phase 5 (import duplicates) and phase 6 (the archive is per link, and a re-save carries the extension's snapshot).
- The archive comes before the reader, and the reader before highlights, because highlights anchor in the reader's frozen article text.
- Localization comes last because it touches every string that the earlier phases add.

## Risks And Open Questions

- **Archive cost.** Every link archived, plus a backfill, adds R2 storage and Files Worker time (the inliner never uses Browser Rendering). Phase 6 measures the median and p95 archive size and the worker CPU time on dev before merging, and estimates the cost of the backfill for the owner before it runs.
- **Archive engine licence.** The common open-source page archivers are SingleFile and monolith. SingleFile is AGPL-3.0 and Teak is MIT. Phase 6 plans its own inliner on `HTMLRewriter`, and flags this for the owner.
- **Saved badge rate limits.** Checking each tab costs one API request, against 120 per minute per user at both the API and the edge. Phase 1 caches results and debounces, and may add a batched, lighter endpoint.
- **Privacy wording.** The badge sends visited URLs, and the extension sends page HTML. Both change what Teak collects. The privacy policy and the extension store listings change in phases 1 and 6.
- **Article text and embeddings.** EmbeddingGemma reads 512 tokens, so long articles are embedded from their title, summary and opening. Phase 7 decides whether to add chunked vectors.
- **Translations without native review.** AI translations are spot-checked only. Phase 9 keeps a glossary and a "report a translation" link.
- **Content-language AI tags** may split tags across languages (`design` and `diseño`). Phase 10 keeps tag matching per language, so those stay separate unless merged by hand on the Tags page.
- **Phase 2 is the heaviest quick win.** A real `savedAt` sort key needs 13 new indexes on cards, folder rows and tag rows, so phase 2 ships as two PRs (the URL key, the `savedAt` fields, indexes and both backfills; then readers, the re-save rule and pasting links). Its plan offers a cheaper alternative for the owner to weigh.
- **Large merged PRs.** Phases 6 and 9 each combine what were two plans. Their plans split the commits by part so reviewers can follow them one at a time.
- **Highlights aren't searchable.** The owner chose to show highlights in the side panel only, so phase 8 keeps search out of scope.

## Open decisions for the owner

Each phase file explains its own open decisions. Until the owner decides, the phase uses the default shown here.

| Phase | Decision | Default |
|---|---|---|
| 1 | Badge text for a saved page | "✓" |
| 1 | Safari | No shortcut or badge this phase (its extension has no `tabs` or `commands`) |
| 2 | Which query parameters to strip | Only `utm_*`, `fbclid` and `gclid`. `#/` and `#!` fragments and query order are kept |
| 2 | A real `savedAt` (13 indexes, 2 PRs) or the cheaper `firstSavedAt` swap | `savedAt`, as decided |
| 2 | Tags and notes sent with a re-save | Dropped, as decided. Imports never bump |
| 2 | Paste limits | 100 links, one paste job at a time |
| 3 | Tables with column alignment | Kept as literal Markdown |
| 4 | How words match | Substring, as today. Uppercase `OR` only. No struck-through pills |
| 5 | CSV dialects | Comma-separated, with a header row required |
| 6 | Run a page's JavaScript on the server | No. Extension saves cover single-page apps |
| 6 | Safari | Server-only archive |
| 6 | Detect soft 404s | No |
| 7 | Chunked embeddings for long articles | No: one vector from the title, summary and opening |
| 7 | Default tab in the card modal | Read for articles, news and research; Preview otherwise |
| 8 | Readwise highlights (its library CSV has none) | No change in v3 |
| 8 | Overlapping highlights | Merged into one |
| 9 | i18n library | next-intl for the web, use-intl for the extension |
| 9 | Chinese and register | Simplified Chinese only, formal register |
| 10 | Setting to keep AI tags in English | No. No backfill of existing cards |
