## Goal

Treat two URLs as the same saved link when they differ only by `http`/`https`, `www.`, a trailing slash, a `#fragment` or tracking parameters (`utm_*`, `fbclid`, `gclid`). The duplicate check (extension, Raycast, CLI, API, MCP, Safari) and import duplicate skipping both use one normalized key. Phase 2 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing. Phases 3, 4, 7 and 9 build on the key.

## Success Criteria

- A new pure function, `urlKey(url)`, gives every saved link a stable key. `cards.urlKey` holds it, indexed by `by_user_urlkey_deleted` beside `by_user_url_deleted`.
- These all match the existing card `https://www.example.com/post/`:
  - `GET /v1/cards/duplicate?url=http://example.com/post#top`
  - the Convex `findDuplicateCard` query (Safari)
  - `teak cards duplicate`
  - MCP `teak_v1_check_duplicate_url`
- Imports skip a URL whose key matches an existing card (`DUPLICATE_URL`) or an earlier row in the same file (`SOURCE_DUPLICATE`).
- The stored `cards.url` never changes. The card opens the exact address that was saved.
- A paged, dry-run-first backfill sets `urlKey` on every existing card. Until it finishes, the duplicate check also falls back to the exact-`url` index.
- No client update is needed.

## Context And Current Facts

- **The duplicate check:** `packages/convex/card/findDuplicateCard.ts:11–29` queries `by_user_url_deleted` with `eq("url", url)` and `isDeleted` undefined, newest first. That is an exact string match. It includes archived cards and excludes trashed ones.
  - Public query `findDuplicateCard` (line 31): used by the Safari extension's `SafariWebExtensionHandler.swift`.
  - Internal query `findDuplicateCardForUser` (line 47).
  - The index is `schema.ts:686` `by_user_url_deleted` `["userId", "url", "isDeleted"]`.
- **Callers of the internal query:**
  - `publicApiDuplicate.ts` (`GET /v1/cards/duplicate`, routed at `http.ts:238`);
  - MCP `teak_v1_check_duplicate_url` (`mcp/tools.ts:624`);
  - SDK `cards.duplicate` (`client/sdk.ts:969`);
  - CLI `cards duplicate` (`apps/cli/src/index.ts:433`).

  The parity row is `scripts/public-parity.ts:105–107`.
- **No normalization exists:**
  - `assertSafeExternalUrl` (`shared/utils/safeUrl.ts:47–60`) only trims.
  - `createCardForUserHandler` stores `finalUrl` as given (`card/createCard.ts`, the `url: finalUrl` insert).
  - The Chrome extension sends `new URL(content).toString()` (`apps/extension/lib/saveToTeak.ts:113`).
  - `normalizeUrlHost` (`shared/utils/urlHost.ts:1–28`) already lowercases the host and strips `www.` for `site:`. It is the model for the host part.
- **Keeping the key in sync:**
  - `withUrlHost` (`card/searchDocumentHelpers.ts:215–228`) recomputes `urlHost` whenever a patch carries `url` or `sourceUrl`.
  - `patchCardWithSearchSync` (line 231) applies it.
  - Search sync also repairs `urlHost` (around line 314).
  - Editing a URL goes through `updateCardField` `"url"` (`card/updateCard.ts:343–349`).
- **Import:**
  - Existing-card skip: `dataImport.ts:554` queries `by_user_url_deleted` and records `DUPLICATE_URL` (line 594).
  - Same-file skip: `importJobItems` `by_jobId_and_url` (lines 439–447, plus `import/indexItems.ts:22`) records `SOURCE_DUPLICATE`.
- **Backfill template:** `migration/backfillUrlHost.ts` (paged, dry run defaults to true, account-deletion gate).
- **Dev seed** queries `by_user_url_deleted` in `devSeed.ts:2568,3058` and `devSeedLinks.ts:74`. These keep working, since that index stays.

## Constraints And Non-goals

- **What `urlKey` does:** parse with `URL`, then:
  - drop the scheme (http and https are equal);
  - lowercase the host, strip trailing dots and a leading `www.`, and drop default ports (80 and 443);
  - remove a single trailing `/` from a non-root path;
  - drop the fragment, except hash routes starting `#/` or `#!`, which are kept;
  - remove query parameters whose lowercased name is `fbclid`, `gclid` or starts with `utm_`;
  - keep every other parameter, in its original order;
  - keep the path's case and percent-encoding as `URL` serializes them.

  It returns `host + path + (query ? "?" + query : "") + kept fragment`. Non-http(s) input returns `undefined`.
- **Schema:** `cards.urlKey: v.optional(v.string())`. Only cards with a `url` get one.
- **No behaviour change on save.** `createCard`, `POST /v1/cards`, bulk, web, share sheets and email-in still always insert. Phase 3 adds the re-save rule.
- **No merging of existing duplicates.** Two existing cards with the same key both stay, and the duplicate check returns the newest.
- **Index rule:** the new index goes beside the old one. `by_user_url_deleted` is dropped only in a later PR, after `devSeed` moves and the backfill finishes (an entry goes in `.agents/sunset.md`).

## Backend

- **New `shared/utils/urlKey.ts`:** `urlKey(url: string): string | undefined`, pure. It is exported from `shared/index.ts` so the web and extension can use the same rule.
- **`schema.ts`:** `urlKey` in `cardValidator`, plus `.index("by_user_urlkey_deleted", ["userId", "urlKey", "isDeleted"])` beside line 686.
- **Setting the key on insert:** `card/createCard.ts` sets `urlKey: urlKey(finalUrl)` next to `urlHost`, in `createCardForUserHandler`. That covers the web, the API, Raycast, email-in and import.
- **Keeping it in sync:**
  - Extend `withUrlHost` in `searchDocumentHelpers.ts` to also set `urlKey` when `url` is in the patch. Rename it `withUrlFields` and update its two callers.
  - Have the search-sync repair (around line 314) also fix a stale `urlKey`.
- **`card/findDuplicateCard.ts`:**
  1. Compute `key = urlKey(url)`.
  2. If there is a key, query `by_user_urlkey_deleted` (`eq urlKey`, `isDeleted` undefined), newest first.
  3. If that misses, fall back to the exact `by_user_url_deleted` lookup. This keeps cards not yet backfilled findable.
  4. Return the first live hit.

  The fallback is listed in `.agents/sunset.md`, to be removed after the backfill has run in production.
- **Imports:**
  - `dataImport.ts`: the existing-card check uses the same helper, so it gets the key and the fallback.
  - `importJobItems` gains `urlKey: v.optional(v.string())` and `.index("by_jobId_and_urlKey", ["jobId", "urlKey"])` beside `by_jobId_and_url`. The same-file check (lines 439–447 and `import/indexItems.ts`) uses the key when the item has one.
  - Items written before the deploy have no key, and their job keeps the URL index (`.agents/sunset.md`).
- **New `migration/backfillUrlKey.ts`,** copied from `backfillUrlHost.ts`:
  - pages `cards` with a `url` and sets `urlKey` where it's missing or stale;
  - skips accounts being deleted;
  - totals: `examined`, `cardsToUpdate`, `skippedDeletingAccounts`;
  - `dryRun` defaults to true.

  Deleted in the PR after its production run.
- **Account deletion:** no new table. The new field is on existing rows.

## Web

- No UI. The web never calls the duplicate check today.

## API / MCP / SDK / CLI

- **No new operation.** The behaviour change applies to `GET /v1/cards/duplicate`.
- **`publicApiOpenApi.ts`:** the operation's description says it matches the same link ignoring `http`/`https`, `www.`, a trailing slash, a `#fragment` and `utm_*`/`fbclid`/`gclid` parameters.
- **MCP:** the same sentence goes in `teak_v1_check_duplicate_url`'s description (`mcp/tools.ts:624`).
- **CLI:** the `cards duplicate` help text gets the same sentence.
- `scripts/public-parity.ts`: no change.

## Docs

- `(developers)/api.mdx`, `mcp.mdx` and `(apps)/cli.mdx`: the matching rule.
- `(data)/import.mdx`: "Links you already have, or that appear twice in the file, are skipped, even when one has `www.`, a trailing slash or tracking parameters."
- The month's changelog: "Teak recognises a link you've already saved, even with tracking parameters".

## UI states

- None of its own. The extension's existing "Already in Teak" state now appears for URL variants too.

## Scenario seed packs

- **`url-variants`:**
  - 40 link cards covering each rule and its near misses:
    - `http` and `https`;
    - `www` and bare;
    - a trailing slash and none;
    - `#section`, `#/route` and `#!/route`;
    - `utm_source` and `utm_medium` together, `fbclid` and `gclid`;
    - `?id=1&utm_source=x` versus `?id=1`;
    - `?id=1` versus `?id=2` (must stay different);
    - `?b=2&a=1` versus `?a=1&b=2` (stay different, by design);
    - uppercase hosts and paths (only the host is case-folded);
    - ports `:443` and `:8080`;
    - IDN hosts, percent-encoded paths, a 2,000-character URL.
  - Half the cards are seeded without `urlKey`, to exercise the fallback and the backfill.

## Break-it checklist

- **Duplicate check:**
  - Each variant through `GET /v1/cards/duplicate`, `teak cards duplicate`, MCP and the Safari `findDuplicateCard` query.
  - A trashed card's key must not match.
  - Two live cards with one key return the newest.
- **Editing:** change a card's URL in the web app (`updateCardField url`), and the duplicate check follows the new URL.
- **Import:** a CSV listing the same link three ways gives one card and two `SOURCE_DUPLICATE` rows. A row matching an existing card gives `DUPLICATE_URL`.
- **Backfill:**
  - The dry run reports counts without writes.
  - Run it twice; the second run updates 0.
  - An account mid-deletion is skipped.
- **Bad input:** `javascript:`, `data:`, an empty string and a malformed URL each return `undefined` and never throw.

## Tests

- `packages/convex/__tests__/shared/utils/urlKey.test.ts`: `test.each` over every rule and near miss in the seed pack, plus fuzz input (random strings never throw).
- `packages/convex/__tests__/card/findDuplicateCard.test.ts`:
  - variants match;
  - trashed cards are excluded;
  - the newest live card wins;
  - the fallback finds a card without `urlKey`.
- `packages/convex/__tests__/card/updateCard.test.ts`: editing the URL updates `urlKey`.
- `packages/convex/__tests__/import/*`: duplicates by key within the file and against the library.
- `packages/convex/__tests__/migration/backfillUrlKey.test.ts`: dry run, apply, idempotence, deletion gate.
- `packages/convex/__tests__/publicApiHttpCards.test.ts` and `__tests__/mcp.test.ts`: the variant matches through HTTP and MCP.

## Proof before the PR

- **Captured requests:** `GET /v1/cards/duplicate` for five variants of one link, each returning the same `cardId`, plus `?id=2` returning `null`.
- **CLI:** `teak cards duplicate` output for the same.
- **Import:** a video of a CSV with variant duplicates, and the import report listing the skipped rows.
- **Backfill:** the dry-run output, then the totals of a real run, on dev.

## Release gate

1. Run the narrow tests, then the repo checks.
2. Seed `url-variants`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge, and deploy Convex. Run `backfillUrlKey` on production: the dry run first, then pages. These runs are the owner's. Smoke-test `teak cards duplicate` with a `utm_` variant of a production card.
5. The next PR removes the backfill. The exact-URL fallback and the old index are removed later, per `.agents/sunset.md`.

## Risks And Open Questions

- **Open decision (default: only `utm_*`, `fbclid` and `gclid` are stripped).** The owner named these. `ref`, `igshid`, `mc_cid`, `si` (Spotify/YouTube share ids) and others are left alone, because some sites use `ref` meaningfully.
- **Open decision (default: `#/` and `#!` fragments are kept).** Single-page apps use them as routes. Every other fragment is dropped.
- **Open decision (default: query parameter order is kept).** Sorting would merge `?a=1&b=2` and `?b=2&a=1`, but it changes the key of every URL with two or more parameters. That is harmless, since it is new, but unnecessary.
- **A key that's too loose** could hide a genuinely different page, for example `example.com/page` versus `example.com/page/` on servers that treat them differently. The duplicate check only answers "already saved"; it never merges or deletes, so the cost is a missed save. Phase 3 bumps the existing card instead of creating a new one, which makes this more visible.
