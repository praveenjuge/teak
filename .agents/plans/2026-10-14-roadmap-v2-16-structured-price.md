## Goal

Turn the product price Teak already scrapes into a structured `{amount, currency}`, show it as a price tag on product tiles, and let people search with `price:<100` and `price:>20`. Existing cards are backfilled. Phase 16 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2.

## Success Criteria

- New product links from Amazon or from pages with JSON-LD `Product`/`Offer` get `metadata.linkCategory.price = { amount, currency? }`. The existing "Price" fact is kept.
- Product tiles in the grid show a price tag, for example "$24.99", "€1.299" or "Free".
- `price:<100`, `price:>20`, `price:<=50` and `price:>=10` filter on the amount only, in any currency. Several of them add up, so `price:>20 price:<100` is a range. They work on every surface that reads searches.
- The backfill fills in price for existing product cards, as a dry run first and then in pages.
- Out of scope (owner decision): no manual price or brand editing, and no background removal.

## Context And Current Facts

- **Amazon.** `workflows/steps/categorization/providers/amazon.ts enrichAmazon`:
  - It reads the price text from `#priceblock_ourprice`, `#priceblock_dealprice`, `.a-price .a-offscreen`, `meta[name='price']` or `og:price:amount`, and the currency from `og:price:currency`.
  - It returns the fact `Price = "<text> <currency>"` and raw `{ price, currency }`.
  - `enrichLinkCategory` (`categorization/index.ts`) merges that raw into `linkCategory.raw.provider` together with `name: "amazon"`.
- **JSON-LD.** `enrichment.ts:396` (`case "product"`):
  - It finds `Product`/`Offer` and adds `Price` from `offers.price` plus `offers.priceCurrency`, then `Brand`.
  - It only handles a single `offers` object. An `offers` array and `AggregateOffer.lowPrice` are ignored.
  - The raw `pickFields(product, STRUCTURED_DATA_FIELDS)` (which includes `offers`) is stored at `linkCategory.raw.structured`.
- Facts are display strings (`linkCategoryFactValidator`: `label`, `value`, `icon?`). `linkCategoryMetadataValidator` (`schema.ts:74`) has no price field.
- **Correction to "backfill from stored raw price".**
  - A `linkCategory.raw` of 1 KiB or more is moved to R2 by `storage/rawMetadataMaintenance.archiveCard` (`serializeArchivableRaw`, `storage/rawMetadata.ts:46`). That leaves `rawStorageKey`/`rawSha256` behind and no inline `raw`.
  - Reading it back needs `hydrateArchivedMetadata`, a signed Files Worker fetch.
  - The "Price" fact string is always inline.
- `updateCategorization` (`categorization/mutations.ts`) writes `metadata.linkCategory` through `patchCardWithSearchSync`.
- The grid tile (`packages/ui/src/components/cards/Card.tsx`) shows no facts today. The modal (`card-previews/LinkPreview.tsx:219`) shows the facts grid.
- **Qualifiers.**
  - There is no numeric qualifier today (`shared/search/qualifiers.ts`).
  - Unquoted values lose leading and trailing ``,.;:!?()[]{}"'`` (`SEARCH_TOKEN_TRIM_CHARACTERS`), so `<` and `>` survive and `price:<9.99` parses.
  - Card-level filters run through `searchPlanner.ts matches` with `hasCardFilters`.
- Native apps decode `linkCategory` with unknown keys ignored: Apple through Codable, Android through `ConvexApi.kt:64` (`ignoreUnknownKeys = true`).
- Backfill template: `migration/backfillUrlHost.ts`. It defaults to `dryRun`, schedules itself batch by batch, and skips accounts that are being deleted (`getAccountDeletionState`).

## Constraints And Non-goals

- The price lives inside `linkCategory`, which keeps it backward compatible and refreshed by Refresh details. No new index; `price:` is a card-level filter, and it narrows types to `link`.
- `parsePrice` is a pure shared function used by the enrichers, the backfill and the tests.
- The backfill never reads R2. It uses inline raw first, then the fact string, and it counts the cards it skips.

## Backend

- `shared/price.ts parsePrice(text, currencyHint?) → { amount, currency? } | null`:
  - It handles grouping and decimal marks: `$1,299.00`, `1.299,00 €`, `1 299,00 zł`.
  - It handles symbols and ISO codes: `$`, `€`, `£`, `¥`, `₹`, `USD 20`.
  - "Free" becomes 0. A range ("$10–$20") takes its low end.
  - It refuses negative numbers, NaN and values over 10,000,000.
  - A `$` without a hint is read as USD.
- `schema.ts`: `linkCategoryMetadataValidator.price: v.optional(v.object({ amount: v.number(), currency: v.optional(v.string()) }))`. The `LinkCategoryMetadata` type gains `price`.
- Enrichers:
  - `providers/common.ts ProviderEnrichmentResult.price?`.
  - `enrichAmazon` returns `price`.
  - `enrichWithStructuredData` returns `price` for products, including an `offers` array and `AggregateOffer.lowPrice`.
  - `enrichLinkCategory` sets `metadata.price`, preferring JSON-LD over provider selectors.
- `qualifiers.ts`:
  - a `price` key whose value is `<N`, `>N`, `<=N`, `>=N` or `=N`
  - `ParsedSearchQuery.prices: { op, amount }[]`
  - a malformed value stays a plain word
- `searchPlanner.ts`: every bound must match `card.metadata?.linkCategory?.price?.amount`. A card without a price never matches, and `hasCardFilters` is true. `localSearch.ts` mirrors this.
- `migration/backfillLinkPrice.ts`:
  - It pages the cards table and handles link cards whose `linkCategory` has no `price`.
  - Sources, in order: inline `raw.structured.offers`, then inline `raw.provider.price/currency`, then the `Price` fact.
  - It writes through `patchCardWithSearchSync`, which patches the value it is given unconditionally. So the write mutation re-reads the card itself, skips it when `metadata.linkCategory.price` is already present (a refresh got there first), and merges the price into the fresh `metadata`, never into a copy from an earlier read.
  - Its totals are `examined`, `priced`, `skippedArchivedRaw`, `unparsable` and `skippedDeletingAccounts`.

## Web

- `cards/Card.tsx`:
  - Link tiles with a price show a small pill over the bottom-left of the image, formatted with `Intl.NumberFormat(locale, { style: "currency", currency })` and falling back to the bare amount.
  - A tile with no image shows the price beside the hostname.
- `searchSuggestions.ts`: a `price:` key hint, "Price under or over".
- `LinkPreview.tsx`: unchanged. The "Price" fact still shows.

## API / MCP / SDK / CLI

- `serializeDisplayMetadata`: `linkPrice: { amount, currency } | null`, in both `serializeCard` and the list's `include=metadata`.
- `publicApiOpenApi.ts`: the `linkPrice` schema, and `price:` in the `q` description.
- The MCP `search_cards` description and the CLI search help (`apps/cli/src/index.ts:185`) mention `price:`. `teak cards get` prints the price.
- SDK: `linkPrice` on the `Card` type.

## Docs

- `features.mdx`: a `price:` row in the Smart search qualifier table, and a sentence in Card details about price tags.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- The ship month's changelog: "Prices on product cards and `price:` search".

## UI states

- Empty: `price:<1` with no matches shows the standard empty search.
- Loading: the tag appears when categorization finishes. Until then the tile shows no pill and no skeleton.
- One item / many items: the pill sits on every product tile and stays legible over light and dark images (frosted background).
- Very long values: "¥1,299,999" and "1.299.999,00 kr" fit at 390px. The pill truncates rather than wrapping.
- Error: an unparsable price shows no pill. The fact still shows in the modal.
- Rate-limited: not applicable.

## Scenario seed packs

- `prices`:
  - Amazon fixtures for .com ($), .de (€), .co.jp (¥) and .in (₹)
  - JSON-LD products with an `offers` array, an `AggregateOffer` low and high price, "Free", "0", "Contact us" and 1,000,000
  - a currency with no amount, and "$-5"
  - cards whose raw is archived, with only the fact string
  - product cards with no image
  - 300-character titles

## Break-it checklist

- UI:
  - the pill at 390px, 768px and 1440px over white and black images
  - RTL titles
  - `price:<100 price:>200` (empty)
  - `price:<100` saved as a smart folder, then edited
- Backend:
  - `parsePrice` fuzz with random unicode digits, `.,` orders and multiple numbers
  - `price:abc`, `price:<`, `price:<1e9` and `price:<-5` stay plain words
  - a backfill dry run writes nothing
  - re-running the backfill adds nothing
  - a card refreshed during the backfill keeps the newer price
  - another user's cards never match

## Tests

- `packages/convex/__tests__/shared/price.test.ts`: a `test.each` table of formats and refusals.
- `packages/convex/__tests__/workflows/steps/categorization/providers/providers.test.ts`: Amazon price.
- `__tests__/workflows/steps/categorization/index.test.ts`: an `offers` array, `AggregateOffer`, and provider versus JSON-LD precedence.
- `__tests__/shared/search/qualifiers.test.ts` and `localSearch.test.ts`: `price:` parsing and filtering.
- `packages/convex/searchQualifiers.test.ts` (convex-test): `price:` bounds across batch pages, and cards without a price.
- `packages/convex/__tests__/migration/backfillLinkPrice.test.ts`: a dry run writes nothing, the source order, archived raw is skipped, pages resume, and a price written between the read and the write is kept.
- `packages/ui/src/components/cards/__tests__/Card.test.tsx`: pill text for USD, EUR, JPY and Free, and no pill without a price.
- `__tests__/publicApiHttpCards.test.ts`, `__tests__/sdk.test.ts`, `apps/cli/src/commands.test.ts`.

## Proof before the PR

- Video 1: a seeded product library, then `price:<50`, then add `price:>20`, then save it as a smart folder.
- Video 2: the nastiest case, mixed currencies and archived-raw cards, before and after the backfill.
- Screenshots of a grid with pills, a no-image tile, a long yen price at 390px, and an empty `price:` search. Each in light and dark, at 390px and 1440px.
- Captured `GET /v1/cards?q=price:<50` and the `teak cards search "price:<50"` output.
- The backfill dry-run totals from dev and from a production dry run.

## Release gate

1. Run the narrow tests above, then the repo checks and `journey/03-api.e2e.ts` and `04-cli.e2e.ts`.
2. Seed `prices`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge, deploy Convex (validator widening) and then web.
5. Run `migration/backfillLinkPrice:backfillLinkPrice` as a dry run and send the totals to the owner. Then run it with `dryRun: false` in pages, watching Convex database I/O.
6. Smoke-test production: save one Amazon link and check the pill and `price:`.

## Risks And Open Questions

- **Correction to the master plan.** Most product raws over 1 KiB are archived to R2, so the backfill relies on the fact string for them. Cards whose fact cannot be parsed stay unpriced until Refresh details.
- **Currency.** Comparing amounts across currencies is crude (owner decision: amount only). A bare `$` may be CAD or AUD on non-US sites. Prefer the hint from `og:price:currency` or `priceCurrency`.
- **Amazon coverage.** Amazon often blocks scrapes, so many Amazon cards have no price. Also, `detectProvider` knows 10 Amazon TLDs while `DOMAIN_RULES` maps only .com, .co.uk and .in to `product`, so the other TLDs may not be categorized as products at all. Consider adding the missing domain rules here.
