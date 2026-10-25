# Search operators

A user types `-` before a word, a phrase or a filter to leave those cards out (`design -figma`, `#inspo -type:image`), uppercase `OR` to match either side (`tag:fonts OR tag:type`), and parentheses to group (`(site:github.com OR site:gitlab.com) -is:archived`). The same text works in the search box, smart folders, the API's `q`, MCP, the CLI, and the iPhone, iPad, Mac and Android apps, which send it as typed. Typing `-` suggests what to leave out, `OR` is suggested after a word, an excluded filter shows as a pill with a "−" before its muted label (not struck through), and the `?` sheet has a "Search" group.

## Sub-features

- `ops-exclude` leaves out cards with a word, a phrase or a `tag:`, `type:`, `site:`, `folder:` or `is:` filter. A `-` inside a word (`to-do`) or after a colon (`price:<-5`) is not an exclusion, and `-like:` and `-mood:` are words.
- `ops-or` matches either side of an uppercase `OR`; a lowercase `or` is a word.
- `ops-groups` groups with parentheses; an unclosed `(` closes at the end, and groups nest at most 4 deep.
- `ops-suggest` shows the "Exclude" group when the word being typed starts with `-`, completes its values like the plain filters, and offers `OR` ("Either side matches") after a word.
- `ops-pills` keeps the operators as pills after Enter and in the URL: an excluded filter reads "Tag −design" with a muted label and the accessible name "Remove excluding tag design", an excluded word reads "−figma", and an OR group shows without its outer parentheses.
- `ops-hidden` keeps hidden cards out: `-tag:hidden` never shows them, and `tag:hidden OR tag:x` shows them only through the `tag:hidden` side.
- `ops-smart-folders` saves operators in a smart folder, shows them in its faded pills, and intersects them with a typed search.
- `ops-shortcuts` lists `-word`, `-tag:x`, `a OR b`, `( … )` and `"phrase"` under "Search" in the `?` sheet.
- `ops-api` takes the operators in `GET /v1/cards?q=`, MCP `teak_v1_search_cards` and `teak search`; the CLI explains how to pass a search that starts with `-`.

## How to get to it (user POV)

- Everything → the search box (`/`) → type `design -figma`, or `-` for the "Exclude" suggestions.
- `?` (focus outside a text field) → "Search" group.
- Sidebar → the pack's smart folders "Fonts or type", "Operators, not archived" and "GitHub or GitLab".
- `teak search 'design -tag:old'`, `GET /v1/cards?q=…`, MCP `teak_v1_search_cards`.
- Apple app: the library's search field (iPhone Home, iPad and Mac toolbar); suggestions appear as suggested tokens under it. See `apple-search-operators` in [apple](./apple.md).
- Android app: Home's search field; suggestions list under it while it has focus. See `android-search-operators` in [android](./android.md).
- The suggestion hints (filters, Exclude, OR, `is:` values) come from `packages/convex/shared/search/suggestionHints.ts` on every app.

## Driving it with e2e MCP

Preconditions:

- Seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"search-operators"}'`, with the id from `.agents/.state/dev-account.json`. It adds 400 cards tagged `scenario-search-operators`, the folders "Inbox" and "Reading list" (reused when they exist) and three smart folders. Every search below starts with `#scenario-search-operators` so seeded cards stay out.
- Mint a key (`scripts/api-key.ts mint`) for the API, CLI and MCP steps.

Expected counts (the pack's design; `packages/convex/edge/devSeed.test.ts` checks them):

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

- **Exclude.** Search `#scenario-search-operators design -figma`: no tile reads "Design in Figma". The URL's `q` keeps `-figma`. Press Enter: the pills read "design" and "−figma", and the URL is unchanged after a reload and Back.
- **Suggestions.** Clear, type `#scenario-search-operators -`: the listbox "Search suggestions" shows "Exclude" with `-tag:` … `-is:` and "Leave out cards with a tag". ArrowDown, Enter, type `ins`, Enter: the pill "Remove excluding tag inspo" appears with a "−" before a muted "inspo". Type ` O` after a word: the option "OR Either side matches".
- **OR and groups.** Search the table's rows, each inside parentheses after the pack tag (`#scenario-search-operators (tag:fonts OR tag:type)`): without them a space binds tighter than `OR`, so `#scenario-search-operators tag:fonts OR tag:type` also matches `tag:type` cards outside the pack. Compare the counts (scroll to the end, or read them through the API with `limit=100` and `nextCursor`).
- **Hidden.** `#scenario-search-operators (tag:hidden OR tag:fonts)` shows "Hidden design diary" tiles; `#scenario-search-operators -tag:hidden diary` shows "Nothing found matching your filters".
- **Smart folders.** Open "Fonts or type": its faded pills show the scenario tag and "tag:fonts OR tag:type". Type `-tag:fonts`: only "Type specimen" tiles remain (20). Open "GitHub or GitLab", type `is:archived OR repo`: the archived repos appear with the rest.
- **Shortcuts.** Press `?`: the "Search" group lists the five rows.
- **API, CLI, MCP.** `GET $SITE/v1/cards?q=%23scenario-search-operators%20design%20-figma&limit=100` returns 60 items over its pages and none whose title has "Figma". `bun apps/cli/src/index.ts search '#scenario-search-operators (tag:fonts OR tag:type)' --all --json` returns 55. `bun apps/cli/src/index.ts search -tag:x` exits 2 with "To leave something out of a search, quote it". MCP `teak_v1_search_cards` with `q: "#scenario-search-operators -is:archived (site:github.com OR site:gitlab.com)"` returns 40.
- **Break it.** `--design`, `- design`, `OR OR`, `(()`, `)design(`, `"-not negated"`, `to-do`, `price:<-5`, `-like:x`, `mood:x OR tag:y` and a 1,000-character `q` each search without an error.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/search-operators.e2e.ts`.
- **Clean up.** Move the pack's cards to Trash with `POST $SITE/v1/cards/bulk` (`"operation":"delete"`, 100 ids a call): list them with `GET $SITE/v1/cards?tag=scenario-search-operators&limit=100` (and again with `&archived=only`), following `pageInfo.nextCursor` until it is null, since the pack holds 400 cards, plus the 10 hidden ones with `q=%23scenario-search-operators%20tag%3Ahidden` (`#` must be encoded, or it starts the URL's fragment), which a tag listing leaves out. Then list the Trash the same way (`&trashed=true`, every page) and `DELETE $SITE/v1/cards/<id>?permanent=true` each one. Check that all three listings come back empty. Delete the smart folders, and "Inbox" and "Reading list" if the seed created them (its result's `folders` count says so), by id from `GET $SITE/v1/folders`. Never clean up with a keyword search.

## Gotchas

- `-design` also leaves out "designer": words match inside longer words.
- In a shell, quote a search with a `-`, and pass one that starts with `-` after `--` (`teak search -- -tag:old`), or the CLI reads it as a flag.
- A search of only exclusions reads the library newest first, so it can need several pages before the first match on a large library.
- The pills keep the order filters, then words: a search typed as `-figma design` comes back as `design -figma`.
- At 390 px the search box shows the pills that fit and clips the rest: a long tag pill can hide an excluded pill beside it. The search still applies every pill.
