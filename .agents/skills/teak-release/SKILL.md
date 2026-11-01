---
name: teak-release
description: Release every Teak product from one prompt: the next-patch version change, the App Store, the browser extension, the CLI, SDK and MCP Registry, Android to Play and the TesterBee testers, and the Raycast Store PR, then a status table. Use when asked to release, ship a new version, or "release everything", or to check how a release is going.
---

# Release Teak

One version change ships everything. Merging it lets `Version Tag` tag `v<version>` and run the Apple (iOS), extension, CLI, SDK, Android and MCP Registry workflows. Android to Play and the Raycast Store PR stay hand steps, done here. The runbooks are the source for each product; this skill is the order to run them in and what went wrong last time. Read `.agents/runbooks/releases.md` first.

Work in a fresh branch from `origin/main` (`git fetch origin`). Never merge with `--auto`: `main` has no required checks, so it merges at once. Wait for green, then `gh pr merge <n> --squash`.

## 1. See what's changing

- Last version: `git describe --tags --abbrev=0 origin/main`. Per product: `git log --oneline v<last>..origin/main -- apps/<apple|android|extension|raycast|cli> packages/sdk`.
- Raycast: compare `apps/raycast` with the store's copy (`extensions/teak-raycast` on `raycast/extensions` main, fetched with `gh api`); only that diff is unreleased. The changelog's top entry may already have shipped under `{PR_MERGE_DATE}`.

## 2. The release PR

1. `bun run release:prepare <next patch>` (lockstep validator included).
2. App Store: rewrite `version.whatsNew` in `apps/apple/store/store.config.json` from the Apple changes.
3. Raycast: in `apps/raycast/CHANGELOG.md`, add `## [<title>] - {PR_MERGE_DATE}` at the top for what the store doesn't have, and give the previous entry its real merge date, as the store's copy has it.
4. Prove Raycast outside the monorepo: copy `apps/raycast` to the scratchpad, then `npm ci`, `npx tsc --noEmit`, `bun test src/__tests__ --isolate`, `npx ray build -e dist` and `npx ray lint`.
5. Commit (the pre-commit hook runs the affected checks), open the PR with the template, merge on green.

## 3. The tag workflows

`gh run list --commit <merge sha>` shows Version Tag and the product runs; Version Tag goes green only when each child does.

- **SDK Release:** npm can take minutes to serve a new version's attestations. The verify step waits for them; if it still fails, `gh run rerun <id> --failed` (an already published version passes when its bytes match).
- **Apple:** iOS submits and waits for review; `asc status --app 6756574989` shows the state. `Apple Release Status` starts the Mac within 15 minutes of iOS going live.
- **Extension:** the job ending green means both stores accepted the upload. AMO's public API shows the live version: `curl -s https://addons.mozilla.org/api/v5/addons/addon/teak/`.
- **MCP Registry:** publishes with `MCP_PRIVATE_KEY` and confirms the version is listed.
- **Android:** attaches `teak-android-<version>.aab` and its mapping to the GitHub Release after uploading the mapping to PostHog.

## 4. Android to Play and TesterBee

`apps/android/release.md` has the tracks and the release note. Download the CI bundle (`gh release download v<version> -p 'teak-android-*.aab'`); upload that exact bundle, since PostHog matches crashes by its map ID.

Play Console is signed in through the Aside browser (`aside guide`; Google account `u/3`). Hand Aside the whole upload in one `aside exec --permission full-access` with: developer `5908919908827380132`, app `4976359198684653280`, internal track `tracks/4701620222568108073` (Save and publish), closed Alpha track `tracks/4698982869449047109` (add the same version code from the bundle library, save, then Publishing overview → Send changes for review), the release note, and "don't touch Production". Its file upload needs the bundle copied into its session's tmp folder. "Native code, no debug symbols" is a known warning.

TesterBee (testerbee.com, campaign `testerbee.com/dashboard/apps/Mk0bIB9YRbDneGIiZrDM`) supplies the closed-test testers. Notify them only once the closed release shows "Available to selected testers": ask Aside to create a routine that checks the Alpha track every 30 minutes and then presses **Notify New Release** with the message, guarded by a marker file `memory/agent/teak-<version>-testerbee-notified.done` so it sends once, and that reports Play's wording and sends nothing if Play rejects. The message lists the Android changes in a sentence and asks testers to update from the Play Store.

Production needs 12 testers opted in for 14 days; Play Console's Dashboard shows the count.

## 5. Raycast Store PR

Read "Raycast extension" in `apps/docs/content/docs/(open-source)/architecture.mdx`.

- `ray publish` refuses `-I` for a public extension and stalls under a script's pseudo-terminal: run `npx ray publish` from `apps/raycast` in a Terminal-panel tab and read it there. It takes about 15 minutes (it clones `raycast/extensions`).
- "getting fork" failing with a 422 about the `workflow` scope means the fork is behind a workflow change upstream; `gh repo sync praveenjuge/raycast-extensions --branch main` and run it again.
- "some contributions are available" means the store changed the extension (the merge bot's changelog date, re-compressed `metadata/` screenshots). `npx @raycast/api@latest pull-contributions` starts a merge: keep ours for code and the changelog, theirs for the PNGs, restore anything outside `apps/raycast` to `HEAD`, commit, and publish again. Land the screenshots on `main` in a PR so the next publish doesn't stop on them.
- It opens a draft PR titled "Update teak-raycast extension". Retitle it `Update Teak: <changelog title>`, write the description from the changes since the store version (the template's Description, Screencast and Checklist, with validation from step 2), and `gh pr ready <n> --repo raycast/extensions`.
- Review bots comment within minutes. Fix in `apps/raycast` on a Teak PR first, then `ray publish` again to push the same commit to the store PR; reply on each thread and resolve it.

## 6. Status table

Check each, live, and report one table (product, where, status, next step):

- iOS and Mac: `asc status --app 6756574989`.
- Chrome: the store page `https://chromewebstore.google.com/detail/negnmfifahnnagnbnfppmlgfajngdpob` shows the live version.
- Firefox: the AMO API above. CLI and SDK: `npm view teak-cli version`, `npm view teak-sdk version`.
- MCP Registry: `https://registry.modelcontextprotocol.io/v0/servers/com.teakvault%2Fmcp/versions/<version>` answers 200.
- Android tracks and the TesterBee routine: a read-only `aside exec` (pages read with `document.body.innerText`).
- Raycast: `gh pr view <n> --repo raycast/extensions`.

## Gotchas

- This shell aliases `cp` to ask before overwriting, which hangs a command; use `/bin/cp -f`. `rm` is blocked; use `trash`. The shell sets `pipefail`, so `… | grep -q` can fail when the producer gets SIGPIPE; capture into a variable first.
- A hand-built Android bundle needs Java: use Homebrew's `openjdk@21` as `JAVA_HOME`, plus gitignored `apps/android/keystore.properties` and `apps/android/local.properties`.
- A docs preview that fails on "CannotFetchFontFile" is Google Fonts timing out: `npx vercel redeploy <deployment id> --scope teak`.
- Never launch the Mac app or take desktop screenshots unasked; drive Raycast's UI only when asked.
- Outward steps (store uploads, notifying testers, the Raycast PR) are what "release" asks for; production rollouts and applying for Play production need their own go-ahead.
