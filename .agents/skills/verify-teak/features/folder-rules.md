# Folder rules

A manual folder can have rules, set in its Edit folder dialog under the name and color: tags every card put in the folder gets, and a search whose matching cards are filed into it. Saving a rule runs it on the cards already in the library (active and archived, not Trash), and new cards are filed once Teak has read them. A toast sums up the run ("Updated 8 cards in Start here") with Undo, and the dialog keeps "Undo last run" for a day. A folder without rules shows only "Add a rule". Smart folders and new folders have no rules, and nothing in the sidebar or folder header marks a folder with rules.

## Sub-features

- `folder-rules-edit` opens the rules from the folder's Edit… menu item or the folder page's "Edit folder" button: "Add a rule" when there are none, the tag field (Enter, comma, Backspace) and the auto-file search with its live "N cards match".
- `folder-rules-tags` tags the cards already in the folder when tags are added, and every card put in the folder later, however it's added.
- `folder-rules-autofile` files existing matches on save and new cards after their AI tags, with the folder's tags.
- `folder-rules-run-undo` shows the one-sentence toast with Undo and "Last run updated N cards." with "Undo last run" in the dialog; Undo takes back only what is still true.
- `folder-rules-guards` rejects `like:` and `mood:` searches, warns that a `secret` or `hidden` tag hides the folder's cards, and keeps a card taken out by hand out.
- `folder-rules-api` covers rule fields, rule runs and undo in the API, CLI and MCP: see [API, CLI and MCP](./api-cli-mcp.md), "Folder rules".

## How to get to it (user POV)

- Sidebar → a folder's "More for <name>" button → menuitem "Edit…" → dialog "Edit folder".
- A folder's page → button "Edit folder" beside its name → dialog "Edit folder".
- In the dialog: button "Add a rule" (folders without rules) → textbox "Add these tags", textbox "Auto-file cards that match", text "N cards match", button "Save"; with a recent run, text "Last run updated N cards." and button "Undo last run".
- After saving: toast "Updated N cards in <name>" with button "Undo".

## Driving it with e2e MCP

Preconditions:

- The local stack (`bun run dev --local --detach`), whose fake AI tags new text cards so auto-file runs. The doctor passes.
- Seed the `folder-rules` pack on the signed-in account: `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"folder-rules"}'` (the newest row of `bunx convex data users` gives the id). Its folders "Rules: tags only", "Rules: typography", "Rules: sourdough", "Rules: paused" and "Rules: private" run their rules as a save does: "Rules: typography" holds the two typography cards and "Rules: sourdough" the sourdough cards, tagged `recipe`.

Steps:

- **Edit (`folder-rules-edit`).** `navigate` to "Start here". `tap` button "Edit folder": the dialog shows Name, Color and button "Add a rule", and no rule fields. `tap` "Add a rule": textbox "Add these tags" (focused) and textbox "Auto-file cards that match" appear. Close with "Cancel".
- **Tags on existing cards (`folder-rules-tags`, `folder-rules-run-undo`).** Open Edit… on "Start here" again, "Add a rule", `type` `verify-<run-id>` into "Add these tags" and `tap` "Save" without pressing Enter: the text still typed is saved. The toast reads "Updated 8 cards in Start here" (the seeded count) with "Undo". `tap` a card: its tags include `verify-<run-id>`. Reopen Edit folder: the tag shows as a chip and "Last run updated 8 cards." with "Undo last run". `tap` "Undo last run": the toast "Undid the rules run for Start here", with no Undo button even while the run's "Updated" toast was still showing, and the card's tag is gone after a reload.
- **Auto-file (`folder-rules-autofile`).** Open Edit… on "Rules: typography": the search `tag:typography` shows "2 cards match" and the folder holds both cards. From Everything (not inside a folder), save the note "Sourdough focaccia verify-<run-id>". Within a few seconds "Rules: sourdough" holds it and the card shows the tag `recipe`.
- **Guards (`folder-rules-guards`).** In Edit… on "Rules: private" the line "Cards in this folder will be hidden from your library, because of the tag secret." shows. `type` `mood:calm` into "Auto-file cards that match": the alert "Folder rules can't use like: or mood:…" shows and "Save" stays disabled. Inside "Rules: sourdough", remove a card with its menu's "Remove from this folder", then add any tag to it: it stays out.
- **No markers.** In the sidebar and on every folder page, folders with rules look like any other folder: no icon, no count change beyond their cards. On a smart folder, Edit… shows only Name, Search and Color.
- **End to end.** `bunx e2e run packages/tests/src/web/folder-rules.e2e.ts` against the local stack.

Cleanup: remove `verify-<run-id>` from "Start here"'s rules (delete the chip, Save), undo any run still undoable, and delete the focaccia card for good.

## Gotchas

- Only a change to the tags or the search starts a run. Renaming or recoloring alone doesn't, and adding only a tag runs the tags, not the filing.
- New cards are filed after their AI tags, a few seconds after saving. Save from Everything so the card starts in no folder.
- The match count checks your 500 newest cards; past that it reads "N of your newest cards match".
- Undo is available for 24 hours and takes back only what is still true: a tag removed by hand since stays removed, and a card the run filed stays out afterwards even if it still matches.
- Rules on the shared dev deployment need its backend from this checkout (`bun run dev --detach --push`); the local stack is simpler.
