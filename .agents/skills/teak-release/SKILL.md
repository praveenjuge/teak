---
name: teak-release
description: Release every Teak product from one prompt: the next-patch version change, the App Store, the browser extension, the CLI, SDK and MCP Registry, Android to Google Play, and the Raycast Store PR, then a status table. Use when asked to release, ship a new version, or "release everything", or to check how a release is going.
---

# Release Teak

One version change ships everything. Merging it lets `Version Tag` tag `v<version>` and run the Apple (iOS), extension, CLI, SDK, Android (to Google Play) and MCP Registry workflows. The Raycast Store PR stays a hand step, done here. The runbooks are the source for each product; this skill is the order to run them in and what went wrong last time. Read `.agents/runbooks/releases.md` first.

Work in a fresh branch from `origin/main` (`git fetch origin`). Never merge with `--auto`: `main` has no required checks, so it merges at once. Wait for green, then `gh pr merge <n> --squash`.

## 1. See what's changing

- Last version: `git describe --tags --abbrev=0 origin/main`. Per product: `git log --oneline v<last>..origin/main -- apps/<apple|android|extension|raycast|cli> packages/sdk`.
- Raycast: compare `apps/raycast` with the store's copy (`extensions/teak-raycast` on `raycast/extensions` main, fetched with `gh api`); only that diff is unreleased. The changelog's top entry may already have shipped under `{PR_MERGE_DATE}`.

## 2. The release PR

1. `bun run release:prepare <next patch>` (lockstep validator included).
2. App Store: rewrite `version.whatsNew` in `apps/apple/store/store.config.json` from the Apple changes. Google Play: rewrite `whatsNew` in `apps/android/store/store.config.json` from the Android changes (500 characters at most), or leave it empty for the generic note.
3. Raycast: in `apps/raycast/CHANGELOG.md`, add `## [<title>] - {PR_MERGE_DATE}` at the top for what the store doesn't have, and give the previous entry its real merge date, as the store's copy has it.
4. Prove Raycast outside the monorepo: copy `apps/raycast` to the scratchpad, then `npm ci`, `npx --no-install tsc --noEmit`, `bun test src/__tests__ --isolate`, `npx --no-install ray build -e dist` and `npx --no-install ray lint` (`--no-install` keeps them to the lockfile's versions).
5. Commit (the pre-commit hook runs the affected checks), open the PR with the template, merge on green.

## 3. The tag workflows

`gh run list --commit <merge sha>` shows Version Tag and the product runs; Version Tag goes green only when each child does.

- **SDK Release:** npm can take minutes to serve a new version's attestations. The verify step waits for them; if it still fails, `gh run rerun <id> --failed` (an already published version passes when its bytes match).
- **Apple:** iOS submits and waits for review; `asc status --app 6756574989` shows the state. `Apple Release Status` starts the Mac within 15 minutes of iOS going live.
- **Extension:** the job ending green means both stores accepted the upload. AMO's public API shows the live version: `curl -s https://addons.mozilla.org/api/v5/addons/addon/teak/`.
- **MCP Registry:** publishes with `MCP_PRIVATE_KEY` and confirms the version is listed.
- **Android:** builds the bundle, uploads its mapping to PostHog, then submits it to Play's internal track and production at full rollout. Green means Play accepted the edit and it's in review; `teak-android-<version>-play.json` on the GitHub Release proves both tracks serve the version. A failure opens an `Android release v<version>` issue with the rerun command (`apps/android/release.md`).

## 4. Raycast Store PR

Read "Raycast extension" in `apps/docs/content/docs/(open-source)/architecture.mdx`.

- `ray publish` refuses `-I` for a public extension and stalls under a script's pseudo-terminal: run `npx --no-install ray publish` from `apps/raycast` (the `ray` that `@raycast/api` installs) in a Terminal-panel tab and read it there. It takes about 15 minutes (it clones `raycast/extensions`).
- "getting fork" failing with a 422 about the `workflow` scope means the fork is behind a workflow change upstream; `gh repo sync praveenjuge/raycast-extensions --branch main` and run it again.
- "some contributions are available" means the store changed the extension (the merge bot's changelog date, re-compressed `metadata/` screenshots). `npx --no-install ray pull-contributions` starts a merge (the CLI's message suggests `@raycast/api@latest`; use the pinned one): keep ours for code and the changelog, theirs for the PNGs, restore anything outside `apps/raycast` to `HEAD`, commit, and publish again. Land the screenshots on `main` in a PR so the next publish doesn't stop on them.
- It opens a draft PR titled "Update teak-raycast extension". Retitle it `Update Teak: <changelog title>`, write the description from the changes since the store version (the template's Description, Screencast and Checklist, with validation from step 2), and `gh pr ready <n> --repo raycast/extensions`.
- Review bots comment within minutes. Fix in `apps/raycast` on a Teak PR first, then `ray publish` again to push the same commit to the store PR; reply on each thread and resolve it.

## 5. Status table

Check each, live, and report one table (product, where, status, next step):

- iOS and Mac: `asc status --app 6756574989`.
- Chrome: the store page `https://chromewebstore.google.com/detail/negnmfifahnnagnbnfppmlgfajngdpob` shows the live version.
- Firefox: the AMO API above. CLI and SDK: `npm view teak-cli version`, `npm view teak-sdk version`.
- MCP Registry: `https://registry.modelcontextprotocol.io/v0/servers/com.teakvault%2Fmcp/versions/<version>` answers 200.
- Android: the store page `https://play.google.com/store/apps/details?id=com.praveenjuge.teak` shows the live version; Play Console's Publishing overview (a read-only `aside exec`) shows whether it's still in review.
- Raycast: `gh pr view <n> --repo raycast/extensions`.

## Gotchas

- This shell aliases `cp` to ask before overwriting, which hangs a command; use `/bin/cp -f`. `rm` is blocked; use `trash`. The shell sets `pipefail`, so `… | grep -q` can fail when the producer gets SIGPIPE; capture into a variable first.
- A docs preview that fails on "CannotFetchFontFile" is Google Fonts timing out: `npx --yes vercel@64.5.0 redeploy <deployment id> --scope teak`, or Redeploy in the Vercel dashboard.
- Never launch the Mac app or take desktop screenshots unasked; drive Raycast's UI only when asked.
- Outward steps (store submissions and the Raycast PR) are what "release" asks for.
