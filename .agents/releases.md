# Shared release preparation

Every Teak product release starts from one next-patch version change. The
preferred path is one command from the repository root:

```bash
bun run release:prepare <version>
```

It validates the next patch, updates every tracked `package.json`, the Safari
WebExtension manifest, and the Mac Xcode marketing/build versions,
synchronizes `bun.lock` (and `apps/raycast/package-lock.json` when present),
then verifies with a frozen install and the lockstep validator. Review the
diff and commit every package manifest and lockfile together as one scoped
version change. The command is resume-safe: if a run fails partway, re-run
it with the same version plus `--resume` to continue from the install step.

Manual fallback (same steps the script performs):

1. Update the `version` field in every tracked `package.json` to the same next patch version.
2. Update `apps/mac/Shared (Extension)/Resources/manifest.json` to the same version.
3. Update every `MARKETING_VERSION` in `apps/mac/teak-mac.xcodeproj/project.pbxproj` to the same version and every `CURRENT_PROJECT_VERSION` to its patch number.
4. Run `bun install` from the repository root to synchronize `bun.lock`.
5. From `apps/raycast`, run `npm install --package-lock-only --ignore-scripts --workspaces=false` to synchronize both version fields in `package-lock.json` without traversing the Bun workspace packages.
6. From the repository root, run `bun install --frozen-lockfile` and `node scripts/release-version.mjs lockstep <version>`. Both commands must exit successfully without changing files.
7. Commit every package manifest, Mac version source, `bun.lock`, and `apps/raycast/package-lock.json` together as one scoped version change.

The preparation is complete when the working tree contains the intended version-only diff and the lockstep validator confirms every package manifest, npm lockfile, and Mac version source uses the target version.

Keep published version tags immutable. The `Version Tag` workflow creates the tag after the version change reaches `main`; do not create or move it manually during the normal release path.

## Public SDK publication

`SDK Release` publishes `teak-sdk` from the same next-patch lockstep tag as
the other products. Branch dispatches, mismatched tags, and commits outside
`main` are rejected. The workflow installs and exercises the packed SDK in
an independent consumer before publishing the exact tarball with provenance.
Retries verify both npm metadata and the downloaded tarball against that
artifact; only an explicit registry version 404 permits publication.

The first SDK release uses the same next-patch lockstep tag. npm requires an
existing package before configuring trust; staging a new package publishes
a placeholder, so use the explicit one-time bootstrap instead:

1. Obtain approval before creating a temporary npm credential or granting
   GitHub access to it. An unpublished unscoped package may require access
   to all packages rather than an exact package restriction. Use the
   shortest expiry, package publish permission with bypass 2FA for the
   unattended bootstrap step, and no organization access.
2. Configure GitHub environment `npm-sdk-bootstrap` with required human
   review and deployment restricted to version tags. Store the approved
   credential only as its `NPM_SDK_BOOTSTRAP_TOKEN` environment secret.
3. Manually dispatch `SDK Release` on the immutable release tag with
   `bootstrap=true`. Bootstrap rejects any existing `teak-sdk` package;
   the secret is exposed only to its publication step. The canonical
   publisher keeps it in memory and writes only an environment placeholder.
4. Verify the published tarball and provenance, then configure npm trust
   for repository `praveenjuge/teak`, workflow `sdk-release.yml`, environment
   `npm-sdk-release`, allowing direct `npm publish` through interactive 2FA.
5. Revoke the temporary npm credential and remove the GitHub bootstrap
   secret. Subsequent releases use `bootstrap=false` and OIDC; they reject
   inherited credentials and never fall back to the bootstrap token.

Account setup and credential storage require separate approval. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[provenance publication](https://docs.npmjs.com/generating-provenance-statements/).

To retry, dispatch `SDK Release` on the existing immutable version tag.
An already published version passes only when its bytes match. A conflict,
registry outage, or failed verification requires investigation; never move
the tag or overwrite a published version.
