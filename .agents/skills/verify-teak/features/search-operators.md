# Search operators

A user leaves cards out with `-` before a word, phrase or filter, matches either side with uppercase `OR`, and groups with parentheses. It works in the search box, smart folders, the API's `q`, MCP, the CLI, and the Apple and Android apps, which send it as typed.

## Sub-features

- `ops-exclude` leaves out cards with a word, a phrase or a `tag:`, `type:`, `site:`, `folder:` or `is:` filter. A `-` inside a word (`to-do`) or after a colon (`price:<-5`) is not an exclusion, and `-like:` and `-mood:` are words.
- `ops-or` matches either side of an uppercase `OR`; a lowercase `or` is a word.
- `ops-groups` groups with parentheses; an unclosed `(` closes at the end, and groups nest at most 4 deep.
- `ops-suggest` shows "Exclude" when the typed word starts with `-`, completes values like plain filters, and offers `OR` after a word.
- `ops-pills` keeps operators as pills after Enter and in the URL: an excluded filter reads "Tag −design" with a muted label (not struck through) and the accessible name "Remove excluding tag design", an excluded word reads "−figma", and an OR group shows without its outer parentheses.
- `ops-hidden`: `-tag:hidden` never shows hidden cards; `tag:hidden OR tag:x` shows them only through the `tag:hidden` side.
- `ops-smart-folders` saves operators in a smart folder, shows them as faded pills, and intersects them with a typed search.
- `ops-shortcuts` lists `tag:design`, `type:note`, `site:github.com`, `folder:reading`, `is:fav`, `-word`, `-tag:x`, `a OR b`, `( … )` and `"phrase"` under "Search" in the `?` sheet.
- `ops-api` takes the operators in `GET /v1/cards?q=`, MCP `teak_v1_search_cards` and `teak search`; the CLI explains how to pass a search that starts with `-`.

## How to get to it (user POV)

- Everything → search box (`/`) → `design -figma`, or `-` for "Exclude" suggestions.
- `?` (focus outside a text field) → "Search" group.
- Sidebar → the pack's smart folders "Fonts or type", "Operators, not archived" and "GitHub or GitLab".
- `teak search 'design -tag:old'`, `GET /v1/cards?q=…`, MCP `teak_v1_search_cards`.
- Apple and Android apps: the library's search field (Home on iPhone and Android, the toolbar on iPad and Mac); see `apple-search-operators` in [apple](./apple.md) and `android-search-operators` in [android](./android.md).
- Every app's suggestion hints come from `packages/convex/shared/search/suggestionHints.ts`.

## Driving it with e2e MCP

Preconditions:

- Seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"search-operators"}'`, with the id from `.agents/.state/dev-account.json`. It adds 400 cards tagged `scenario-search-operators`, the folders "Inbox" and "Reading list" (reused when they exist) and three smart folders. Every search below starts with `#scenario-search-operators` to keep other cards out.
- Mint a key (`scripts/api-key.ts mint`) for the API, CLI and MCP steps.

Expected counts (`packages/convex/edge/devSeed.test.ts` checks them):

| Search, written as `#scenario-search-operators (…)` | Cards |
| --- | --- |
| `design` | 90 |
| `design -figma` | 60 |
| `#inspo -type:image` | 20 |
| `tag:fonts OR tag:type` | 55 |
| `(site:github.com OR site:gitlab.com) -is:archived` | 40 |
| `tag:hidden OR tag:fonts` | 45 (the 10 hidden diaries appear only here) |
| `-tag:hidden diary` | 0 |
| `"total due" -type:image` | 5 |
| `price:<100 OR price:>300` | 9 |

Steps:

- **Exclude.** Search `#scenario-search-operators design -figma`: no tile reads "Design in Figma" and the URL's `q` keeps `-figma`. Enter: pills "design" and "−figma"; a reload and Back keep the URL.
- **Suggestions.** Clear, type `#scenario-search-operators -`: listbox "Search suggestions" shows "Exclude" with `-tag:` … `-is:` and "Leave out cards with a tag". ArrowDown, Enter, type `ins`, Enter: the pill "Remove excluding tag inspo", with a "−" before a muted "inspo". Type ` O` after a word: the option "OR Either side matches".
- **OR and groups.** Search each table row in parentheses after the pack tag, since a space binds tighter than `OR` (`#scenario-search-operators tag:fonts OR tag:type` also matches `tag:type` cards outside the pack). Compare counts (scroll to the end, or page the API with `limit=100` and `nextCursor`).
- **Hidden.** `#scenario-search-operators (tag:hidden OR tag:fonts)` shows "Hidden design diary" tiles; `#scenario-search-operators -tag:hidden diary` shows "Nothing found matching your filters".
- **Smart folders.** Open "Fonts or type": its faded pills show the scenario tag and "tag:fonts OR tag:type". Type `-tag:fonts`: only "Type specimen" tiles remain (20). In "GitHub or GitLab", type `is:archived OR repo`: the archived repos join the rest.
- **Shortcuts.** Press `?`: "Search" lists the ten rows, "Go to" reads "Everything", "Favorites", "Archive", "Trash", "Tags", "Settings", and "Anywhere" has "Focus notifications, to undo a change". One "Close" button, in the sheet's corner.
- **API, CLI, MCP.** `GET $SITE/v1/cards?q=%23scenario-search-operators%20design%20-figma&limit=100` returns 60 items across pages, none titled with "Figma". `bun apps/cli/src/index.ts search '#scenario-search-operators (tag:fonts OR tag:type)' --all --json` returns 55. `bun apps/cli/src/index.ts search -tag:x` exits 2 with "To leave something out of a search, quote it". MCP `teak_v1_search_cards` with `q: "#scenario-search-operators -is:archived (site:github.com OR site:gitlab.com)"` returns 40.
- **Break it.** `--design`, `- design`, `OR OR`, `(()`, `)design(`, `"-not negated"`, `to-do`, `price:<-5`, `-like:x`, `mood:x OR tag:y` and a 1,000-character `q` each search without an error.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/search-operators.e2e.ts`.
- **Clean up.** Trash the pack's cards with `POST $SITE/v1/cards/bulk` (`"operation":"delete"`, 100 ids a call), listed with `GET $SITE/v1/cards?tag=scenario-search-operators&limit=100` and again with `&archived=only`, following `pageInfo.nextCursor` until null, plus the 10 hidden ones a tag listing skips, with `q=%23scenario-search-operators%20tag%3Ahidden` (encode `#`, or it starts the URL's fragment). Then list the Trash the same way (`&trashed=true`, every page) and `DELETE $SITE/v1/cards/<id>?permanent=true` each one. All three listings must come back empty. Delete the smart folders, and "Inbox" and "Reading list" if the seed's `folders` count shows it created them, by id from `GET $SITE/v1/folders`. Never clean up with a keyword search.

## Gotchas

- `-design` also leaves out "designer": words match inside longer words.
- In a shell, quote a search with a `-`, and pass a leading `-` after `--` (`teak search -- -tag:old`), or the CLI reads a flag.
- An exclusions-only search reads the library newest first, so a large library can need several pages before the first match.
- Pills order filters, words, then exclusions and groups: `-figma design` becomes `design -figma`, from Enter or a URL.
- At 390 px pills truncate with an ellipsis, never cut off; each tooltip has the full text, and the search applies every pill.
