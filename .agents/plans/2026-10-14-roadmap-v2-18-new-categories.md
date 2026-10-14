## Goal

Add six link categories: place (restaurants, venues and real estate), typeface, social_post, app, game and repo. They get domain and path rules, JSON-LD facts where the pages publish them, and a backfill that recategorizes existing links. Phase 18 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 15](2026-10-14-roadmap-v2-15-done-states.md): the done-verb map and `is:todo` gain `app` ("done") and `game` ("played").

## Success Criteria

- Each new category resolves for its sites:
  - a Steam or itch.io game, an App Store or Play Store app
  - a Google Maps, Yelp or Zillow place
  - a Google Fonts specimen
  - a GitHub or Codeberg repository (owner/repo paths only)
  - an X, Bluesky, Threads, TikTok, Reddit, LinkedIn, Mastodon or Substack Notes post
- Places, apps and games get facts from JSON-LD: address, rating, platform and genre.
- `is:todo` includes app and game, and a game card's toggle reads "Mark as played".
- After the backfill, existing links on these domains carry the new category, and their facts and raw data are untouched.
- The iPhone, iPad, Mac and Android apps keep working with no update.

## Context And Current Facts

- **Categories.**
  - `shared/linkCategories.ts` has 15 categories, with `LINK_CATEGORY_LABELS` and `LINK_CATEGORY_ICONS` as exhaustive maps.
  - `normalizeLinkCategory` builds a lookup from the label parts (split on `/,|()-`), and later categories overwrite earlier keys. Today "App" maps to `software` through the label "Software / App / GitHub Project".
  - Only tests read the labels, icons and `normalizeLinkCategory`.
- `schema.ts:25-31` builds `linkCategoryValidator` from `LINK_CATEGORIES`, so adding values widens it.
- **Classification is rules-only.**
  - `classifyLinkCategory` (`categorization/index.ts`) calls `resolveLinkCategory` (`shared/utils/linkCategoryResolver.ts`), which uses `DOMAIN_RULES`, `PATH_CATEGORY_RULES`, `PROVIDER_CATEGORY_HINTS` and `HEURISTIC_KEYWORDS`.
  - **There is no AI classifier prompt for link categories**, despite what the approved plan says.
- **Current mappings.**
  - github.com, gitlab.com, bitbucket.org, npmjs.com, pypi.org, rubygems.org and itch.io all map to `software`.
  - x.com, instagram.com, reddit.com, bsky.app, apps.apple.com, steampowered.com and maps sites have no rule.
- `classifyHandler` skips reclassifying while `linkCategory` is fresh (`METADATA_TTL_MS` = 30 days) for the same URL. Existing cards therefore keep their old category until Refresh details or the TTL, hence the backfill.
- `providers/index.ts`: the `github` handler has `categories: ["software"]`. `enrichProvider` drops provider enrichment when the category is not listed (unless confidence is below 0.6), so `repo` must be added or repos lose their Stars and Forks facts.
- JSON-LD enrichment (`enrichment.ts:276-516`) has one `case` per category. `default` adds nothing.
- **Native tolerance (verified).**
  - Apple: `LinkCategory.category: String?` (`apps/apple/Packages/TeakKit/Sources/TeakCore/Models/Card.swift:193-194`). `Logic/CardSheet.swift:229` renders only `facts`.
  - Android: `category: String? = null` (`apps/android/core/model/.../Card.kt:98-99`) with `ignoreUnknownKeys = true` (`core/data/.../ConvexApi.kt:64`). `feature/card/.../CardSections.kt:77` renders only `facts`.
  - Raycast never reads the category.
  - No app maps the category to an enum, so **no tolerant client update is needed first**.
- The web never shows a category name; it shows facts only (`LinkPreview.tsx:219`). Phase 15 adds `linkCategory` to the API as a plain string.

## Constraints And Non-goals

- Append the new values before `other`. Never rename or remove an existing value.
- The rules are deterministic, with no new fetches. Social-post fetchers come in phase 19 and site detail fetchers in phase 20.
- The backfill only moves a card when a domain or path rule now gives a new category. It never moves a card to `other`, and it keeps facts, raw data and confidence.

## Backend

- `shared/linkCategories.ts`:
  - Labels:
    - place: "Place / Restaurant / Venue / Real Estate"
    - typeface: "Typeface / Font"
    - social_post: "Social Post"
    - app: "App / Mobile or Desktop App"
    - game: "Game / Video Game"
    - repo: "Code Repository"
  - Relabel `software` to "Software / Developer Tool" so "app" resolves to `app`.
  - Icons: `MapPin`, `Type`, `MessageSquare`, `AppWindow`, `Gamepad2` and `FolderGit2`.
  - Done verbs: game is "played", and the rest are "done". `ACTIONABLE_LINK_CATEGORIES` gains app and game.
- `linkCategoryResolver.ts` `DOMAIN_RULES` (with `pathIncludes` where noted):
  - repo: github.com, gitlab.com, bitbucket.org, codeberg.org and sr.ht, for `^/[^/]+/[^/]+/?$` and deeper repo paths. Excluded first segments include `features`, `pricing`, `orgs`, `marketplace` and `topics`.
  - app: apps.apple.com `/app/`, play.google.com `/store/apps/`, chromewebstore.google.com and apps.microsoft.com.
  - game: store.steampowered.com `/app/`, itch.io (moved from software), store.epicgames.com, gog.com `/game/` and boardgamegeek.com `/boardgame/`.
  - place:
    - maps: google.com `/maps`, maps.app.goo.gl, maps.apple.com
    - food and travel: yelp.com `/biz/`, tripadvisor.com, opentable.com, resy.com, airbnb.com `/rooms/`, booking.com `/hotel/`
    - real estate: zillow.com `/homedetails/`, redfin.com, rightmove.co.uk `/properties/`, realtor.com
  - typeface: fonts.google.com `/specimen/`, fonts.adobe.com `/fonts/`, myfonts.com, fontshare.com and futurefonts.xyz.
  - social_post:
    - x.com and twitter.com `/status/`
    - instagram.com `/p/` and `/reel/`
    - bsky.app `/post/`
    - threads.net and threads.com `/post/`
    - tiktok.com `/video/`
    - reddit.com `/comments/`
    - linkedin.com `/posts/` and `/feed/update/`
    - substack.com `/note/`
  - `PATH_CATEGORY_RULES`: Mastodon-style `^/@[^/]+/\d+$` maps to social_post.
- `providers/index.ts`: github `categories: ["software", "repo"]`.
- `enrichment.ts` new cases:
  - place (`Restaurant`, `LocalBusiness`, `Place`, `LodgingBusiness`, `Residence`, `SingleFamilyResidence`, `Apartment`, `RealEstateListing`): Address, Cuisine, Price range, Rating, and an image
  - app (`SoftwareApplication`, `MobileApplication`, `WebApplication`): Platform, Category, Rating
  - game (`VideoGame`): Platform, Genre, Rating, Released
  - typeface, social_post and repo add no JSON-LD case.
- `migration/backfillLinkCategories.ts`:
  - It defaults to a dry run, pages the cards table and skips non-link cards and accounts being deleted.
  - It recomputes `resolveLinkCategory(card.url)`, and patches `metadata.linkCategory.category` through `patchCardWithSearchSync` only when the reason is `domain_rule` or `path_rule` and the category changed.
  - Its totals are counted per from→to pair.

## Web

- No new surface. Game cards read "Mark as played", and app cards "Mark as done". Place, app and game facts show in the existing facts grid.

## API / MCP / SDK / CLI

- `linkCategory` (from phase 15) can now carry the new values. `publicApiOpenApi.ts` keeps it a plain `string`, with the known values in its `description` and never as an `enum`, so generated clients tolerate future values.
- The SDK type stays `string | null`. `teak cards get` prints the category label.

## Docs

- `features.mdx`, AI enrichment: the Categorization row lists the categories, and Card details mentions place, app and game facts.
- `(developers)/api.mdx`: the `linkCategory` values.
- The ship month's changelog: "Teak now recognizes places, fonts, apps, games, code repositories and social posts".

## UI states

- Empty: not applicable (no new surface).
- Loading: categories arrive with categorization, as today.
- One item / many items: the facts grid holds up to 8 facts on a tile row (`sm:grid-cols-4`).
- Very long names: long addresses wrap in the fact value (`break-words`).
- Error: a page without JSON-LD gets its category and no facts.
- Rate-limited: not applicable.

## Scenario seed packs

- `categories-new`:
  - one card per new rule above
  - near misses that must stay put: github.com/features, github.com/<user>, play.google.com/store/movies, google.com/search, reddit.com/r/<sub> (no post) and a Mastodon-like path on a non-Mastodon blog
  - JSON-LD fixtures for Restaurant, RealEstateListing, MobileApplication and VideoGame
  - Apple and Android decoding fixtures with every new category

## Break-it checklist

- UI: the done wording on every new category, facts at 390px with long addresses and CJK venue names.
- Backend:
  - a table of URLs including uppercase hosts, `www.` and mobile subdomains (`m.`, `mobile.twitter.com`)
  - `maps.app.goo.gl` short links that redirect
  - a repo URL with `.git`
  - the dry run matches the real run's counts
  - re-running the backfill moves nothing
  - a card refreshed during the backfill
  - GitHub enrichment still adds Stars for `repo`

## Tests

- `packages/convex/__tests__/shared/linkCategories.test.ts`: the exact list, labels, icons, verbs, and `normalizeLinkCategory("app") === "app"`.
- `packages/convex/__tests__/shared/utils/linkCategoryResolver.test.ts`: `test.each` over the seed URLs, including the near misses.
- `packages/convex/__tests__/workflows/steps/categorization/providers/providers.test.ts`: github enriches `repo`.
- `__tests__/workflows/steps/categorization/index.test.ts`: the place, app and game JSON-LD facts.
- `packages/convex/__tests__/migration/backfillLinkCategories.test.ts`: the dry run, no move to `other`, facts kept, resuming.
- Apple: a decoding test in `apps/apple/Packages/TeakKit/Tests/TeakCoreTests/CardTests.swift` with the new categories.
- Android: `apps/android/feature/card/src/test/kotlin/com/praveenjuge/teak/feature/card/CardDetailUiTest.kt` renders a `place` card's facts.

## Proof before the PR

- Video 1: save a Steam game, a Yelp restaurant and a GitHub repo. See the facts, and "Mark as played" on the game.
- Video 2: the backfill dry run against `categories-new`, then a real run, with `is:todo` before and after.
- Screenshots of place, app and game facts in light and dark, at 390px and 1440px, and the iPhone simulator showing a `place` card on the current App Store build.
- The backfill dry-run report from dev and production, and `GET /v1/cards/:id` with the new `linkCategory`.

## Release gate

1. Run the narrow tests above, the Swift and Kotlin tests, the repo checks and `journey/03-api.e2e.ts`.
2. Seed `categories-new`. Confirm the shipped Apple build (TestFlight or App Store) and the Android debug build open those cards. Run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex (validator widening), then web.
5. Run `backfillLinkCategories` as a dry run, send the totals to the owner, then run it in pages.
6. Smoke-test production: save one link per new category.

## Risks And Open Questions

- **Correction to the approved plan.** There is no classifier prompt to update; categories come only from the resolver rules. Sites outside the rules still fall to the heuristics or `other`.
- **itch.io.** Moving it from software to game also recategorizes its tool pages. This is accepted.
- **Saved searches.** The backfill changes categories under `is:todo` smart folders. Mention it in the changelog.
- **The master plan's caution about native decoders.** It did not apply: both apps decode the category as a free string. The tests above keep it that way.
