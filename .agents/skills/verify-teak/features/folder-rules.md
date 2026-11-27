# Folder rules

A manual folder can have rules: tags every card put in the folder gets, and a search whose matches are filed into it. Saving a rule runs it on the library's cards (active and archived, not Trash); new cards are filed once Teak has read them. A run can be undone for a day. Smart folders and new folders have no rules.

## Sub-features

- `folder-rules-edit` shows "Add a rule" when there are none, then the tag field (Enter, comma, Backspace) and the auto-file search with its live "N cards match".
- `folder-rules-tags` tags the folder's cards when tags are added, and every card put in later by any route.
- `folder-rules-autofile` files existing matches on save and new cards after their AI tags, with the folder's tags.
- `folder-rules-run-undo` shows the run's toast with Undo, and "Undo last run" in the dialog.
- `folder-rules-guards` rejects `like:` and `mood:` searches, warns that a `secret` or `hidden` tag hides the folder's cards, and keeps a card taken out by hand out.
- `folder-rules-api` covers rule fields, rule runs and undo in the API, CLI and MCP: see [API, CLI and MCP](./api-cli-mcp.md), "Folder rules".

## How to get to it (user POV)

- Sidebar → a folder's "More for <name>" button → menuitem "Edit…", or a folder's page → button "Edit folder": dialog "Edit folder".
- In the dialog: button "Add a rule" (folders without rules) → textbox "Add these tags", textbox "Auto-file cards that match", text "N cards match", button "Save"; with a recent run, text "Last run updated N cards." and button "Undo last run".
- After saving: toast "Updated N cards in <name>" with button "Undo".

## Driving it with e2e MCP

Preconditions:

- The local stack (`bun run dev --local --detach`), whose fake AI tags new text cards so auto-file runs. The doctor passes.
- Seed the `folder-rules` pack on the signed-in account: `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"folder-rules"}'` (the newest row of `bunx convex data users` gives the id). It creates and runs "Rules: tags only", "Rules: typography", "Rules: sourdough", "Rules: paused" and "Rules: private": "Rules: typography" holds the two typography cards and "Rules: sourdough" the sourdough cards, tagged `recipe`.

Steps:

- **Edit (`folder-rules-edit`).** On "Start here", `tap` "Edit folder": Name, Color and "Add a rule", no rule fields. `tap` "Add a rule": "Add these tags" (focused) and "Auto-file cards that match" appear. "Cancel".
- **Tags on existing cards (`folder-rules-tags`, `folder-rules-run-undo`).** Reopen, "Add a rule", `type` `verify-<run-id>` into "Add these tags" and `tap` "Save" without pressing Enter: the typed text is saved. Toast "Updated 8 cards in Start here" (the seeded count) with "Undo". A card's tags include `verify-<run-id>`. Reopen Edit folder: the tag is a chip, with "Last run updated 8 cards." and "Undo last run". `tap` "Undo last run": toast "Undid the rules run for Start here", with no Undo button (even while the "Updated" toast still shows), and the card's tag is gone after a reload.
- **Auto-file (`folder-rules-autofile`).** Edit… on "Rules: typography" shows `tag:typography` and "2 cards match"; the folder holds both. From Everything, save the note "Sourdough focaccia verify-<run-id>": within seconds "Rules: sourdough" holds it, tagged `recipe`.
- **Guards (`folder-rules-guards`).** Edit… on "Rules: private" shows "Cards in this folder will be hidden from your library, because of the tag secret." `type` `mood:calm` into "Auto-file cards that match": alert "Folder rules can't use like: or mood:…" and "Save" stays disabled. In "Rules: sourdough", "Remove from this folder" on a card, then tag it: it stays out.
- **No markers.** Folders with rules show no icon or extra count in the sidebar or on their pages. On a smart folder, Edit… shows only Name, Search and Color.
- **End to end.** `bunx e2e run packages/tests/src/web/folder-rules.e2e.ts` against the local stack.

Cleanup: remove `verify-<run-id>` from "Start here"'s rules (delete the chip, Save), undo any run still undoable, and delete the focaccia card for good.

## Gotchas

- Only changing the tags or search starts a run (not renaming or recoloring); adding only a tag runs just the tags, not the filing.
- New cards are filed seconds after saving, once AI-tagged; save from Everything so the card starts in no folder.
- The match count checks your 500 newest cards; past that it reads "N of your newest cards match".
- Undo lasts 24 hours and takes back only what is still true: a tag removed by hand stays removed, and a card the run filed stays out even if it still matches.
- Rules on the shared dev deployment need its backend from this checkout (`bun run dev --detach --push`); the local stack is simpler.
