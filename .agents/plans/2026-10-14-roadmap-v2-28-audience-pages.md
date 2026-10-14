## Goal

Add four marketing pages to the docs site, each showing one kind of person how Teak fits their work: designers, developers, researchers and writers, and people with ADHD who want to save without filing. Link the pages from the homepage and the footer. Phase 28 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 14](2026-10-14-roadmap-v2-14-similar-and-mood.md) (More like this, `like:` and `mood:`), so the pages can show the search features that have shipped. Blended search (phase 13), OCR (phases 10 and 11), done states (phase 15) and card links (phases 26 and 27) are shown only if they have shipped by then.

## Success Criteria

- `teakvault.com/designers`, `/developers`, `/researchers` and `/adhd` render through `MarketingLayout.astro`. Each has:
  - one H1 and a single "Get started" primary action (`https://app.teakvault.com/register`)
  - 3–6 feature tiles built from `FeatureCard.astro`
  - a slice of the homepage demo cards picked for that audience
  - a short FAQ with FAQ JSON-LD
- The copy describes what Teak does, in Teak's own words, and only claims shipped behavior:
  - **Designers:** search images by color, style and mood (`mood:`); "More like this"; boards in folders; screenshots readable by their text.
  - **Developers:** API, MCP, CLI and SDK; Raycast; search qualifiers; Markdown notes; save links and code snippets.
  - **Researchers and writers:** PDFs and articles with readable text, transcripts, `[[` links between notes, feeds, export.
  - **ADHD, "save without filing":** save in one step from anywhere, automatic tags and summaries, search that finds things by meaning, Revisit to resurface, and hidden cards for private things. There's no sorting to do.
- The homepage has a "Teak for…" row linking all four. The footer gains a small link row with the same four.
- `bun run --cwd apps/docs build` passes, including `blume audit` and the JS and CSS budgets. Lighthouse scores 95 or higher in every category on each page, on mobile.

## Context And Current Facts

- **Pages.** `apps/docs/pages/` holds `index.astro`, `apps.astro`, `pricing.astro` and `changelog.astro`. Each is wrapped in `MarketingLayout.astro`, which takes:
  - `title`, `description`, `canonical`, `jsonLd`, `ogImage` and `keywords`
  - the header, the footer and a `pt-20` content wrapper
- **Schema helpers.** `lib/jsonld.ts` `buildPageSchemas({ title, description, url, breadcrumbs, faqs })` builds the page and FAQ schemas, which `pricing.astro` uses.
- **`FeatureCard.astro`** (`title`, `description`, `emojiSrc`, `emojiAlt`) exists but **no page uses it today**. Emoji assets live in `public/emojis/`.
- **Demo cards.** The homepage demo is `components/HomeAppDemo.astro` plus `HomeAppDemo.client.ts`. It renders `DEMO_COLUMNS` from `lib/home-demo-cards.ts` and **takes no props**, so reusing a slice needs an optional `columns` prop.
- **Header and footer.** `Header.astro` `navLinks` lists Pricing, Apps, Changelog and Docs. **`Footer.astro` has no page links today**, only a call to action, the logo and the GitHub and X icons.
- **Sitemap.** It's generated (`blume.config.ts` `sitemap: true`), so new pages are included automatically.
- **Tests.** Docs tests live in `apps/docs/lib/**`. `lib/home-headings.test.ts` checks that the homepage has one H1 and a correct heading order. It reads page source, which `.agents/testing.md` allows only as a last resort.
- **Docs rules.** Under `apps/docs/AGENTS.md`, "marketing page changes need no public entry". No changelog entry.
- **Rejected by the owner:** comparison pages.

## Constraints And Non-goals

- No comparison pages and no mention of other products. Plain, specific, sentence-case copy. Name only features that exist in production on the day the page merges.
- The ADHD page:
  - Supportive, non-clinical language. No medical or treatment claims, and no "cure" or "fix" wording. Speak about working styles ("if filing things gets in the way").
  - The owner reviews the copy before merge.
- No new JS islands beyond the existing demo. Keep under `--budget-js=850 --budget-css=220`.
- Page content lives in a typed data module, so tests read data, not source text.
- No changes to `features.mdx` or the changelog.

## Docs site

- `lib/audience-pages.ts` exports `AUDIENCE_PAGES`. Each entry is `{ slug, navLabel, title, description, h1, intro, features: [{ title, description, emojiSrc, emojiAlt }], demoCardIds: string[], faqs: [{ question, answer }] }`, for the slugs `designers`, `developers`, `researchers` and `adhd`.
- `components/AudiencePage.astro` renders the page from one entry:
  - a hero (H1, intro, primary action)
  - a `HomeAppDemo columns={…}` slice
  - a `FeatureCard` grid (1 column under 561px, 3 columns from 861px)
  - the FAQ through blume's `Accordion`, as `pricing.astro` does
  - a closing call to action
- `pages/designers.astro`, `developers.astro`, `researchers.astro` and `adhd.astro` are each a thin wrapper that passes `AUDIENCE_PAGES[slug]` and `buildPageSchemas({ …, url: SITE_URL + "/" + slug, faqs })`.
- `components/HomeAppDemo.astro` gets an optional `columns?: DemoCard[][]` prop that defaults to `DEMO_COLUMNS`. `lib/home-demo-cards.ts` gets `pickDemoColumns(ids)`.
- `pages/index.astro` gets a "Teak for…" section after `HomeFeatureShowcase`: four links built from `AUDIENCE_PAGES` (label plus one line each).
- `components/Footer.astro` gets a muted link row above the logo row: "For designers · developers · researchers · ADHD".
- New emoji assets, if any, go in `public/emojis/` as `.webp` at 112×112.

## Docs

- No `content/docs` or changelog changes (`apps/docs/AGENTS.md`: marketing page changes need no entry).

## UI states

- Empty: not applicable. Every page has fixed content. A missing demo card ID fails the tests, not the page.
- Loading: static HTML. The demo island hydrates as it does on the homepage, and its first render is the server markup.
- One item / many items: each page has 3–6 feature tiles and 3–5 FAQs. The homepage row has 4 links.
- Very long names: the German-length test strings in the tests wrap without overflow at 390px.
- Error: an unknown slug returns blume's 404 page (and the markdown 404 negotiation in `lib/markdown-not-found.ts`).
- Rate-limited: not applicable (static).

## Scenario seed packs

- No Convex data. The "pack" is the page set itself:
  - all four pages at 390px, 768px and 1440px, in light and dark
  - with JS disabled (the demo's server markup)
  - with `prefers-reduced-motion`
  - a Lighthouse run per page on mobile and desktop
  - a link check across the whole site build

## Break-it checklist

- Every internal link resolves (`blume audit`), and the external `app.teakvault.com` links are correct.
- One H1 per page and a correct heading order. Image `alt`s are present, and decorative emojis are `aria-hidden`.
- Keyboard: the FAQ accordion and the demo work by keyboard alone, and focus rings are visible in both themes.
- Feature claims: every claim maps to a shipped feature. Re-read against `features.mdx` on merge day.
- Footer row at 390px wraps cleanly. The homepage still passes `home-headings.test.ts`.

## Tests

- `apps/docs/lib/audience-pages.test.ts`:
  - every slug is unique and matches a file in `pages/`
  - every `demoCardIds` entry exists in `DEMO_COLUMNS`
  - titles are 60 characters or fewer and descriptions 160 or fewer
  - each page has 3–6 features and at least 3 FAQs
  - no copy contains another product's name (a fixed deny-list)
- `apps/docs/lib/home-demo-cards.test.ts`: `pickDemoColumns` keeps order and balances the columns.
- `apps/docs/lib/jsonld.test.ts` (extend): FAQ schema for one audience page.
- `apps/docs/lib/home-headings.test.ts`: still passes with the new homepage section.

## Proof before the PR

- Video: scroll each of the four pages at 390px in dark mode, open an FAQ by keyboard, then follow the homepage "Teak for…" link and the footer link.
- Screenshots: each page in light and dark at 390px and 1440px, the homepage row and the footer row.
- Lighthouse reports (mobile) for the four pages, and the `bun run --cwd apps/docs build` output, including the audit and budgets.

## Release gate

1. Run `bun run --cwd apps/docs test`, `typecheck`, `lint` and `build` (audit plus budgets).
2. Do the break-it pass above; fix any issue and add a regression test.
3. Send the proof bundle, and get the owner's approval of the ADHD page copy.
4. Open the PR, get CI green, and merge. The docs site deploys through its Vercel project. No backend or worker change.
5. Smoke-test production: open all four URLs, check `sitemap.xml` lists them, and run Lighthouse once on production.

## Risks And Open Questions

- Copy about ADHD can read as a health claim. Keep it to working style, and have the owner review the wording. Should the slug be `/adhd` or a softer `/save-without-filing`? Proposed `/adhd` for search, with "Save without filing" as the H1.
- The pages promise features from phases 10–27. If any of them slip past this phase, drop that line instead of promising it.
- Nav placement: the header stays unchanged (four links), to keep it calm. Revisit this after a month of analytics.
