# Shared release preparation

Every Teak product release starts from one next-patch version change. The
preferred path is one command from the repository root:

```bash
bun run release:prepare <version>
```

It validates the next patch, updates every tracked `package.json`, both Safari
WebExtension manifests, the Mac Xcode marketing/build versions, and the Apple
app's marketing version, synchronizes `bun.lock` (and `apps/raycast/package-lock.json` when present),
then verifies with a frozen install and the lockstep validator. Review the
diff and commit every package manifest and lockfile together as one scoped
version change. The command is resume-safe: if a run fails partway, re-run
it with the same version plus `--resume` to continue from the install step.

Manual fallback (same steps the script performs):

1. Update the `version` field in every tracked `package.json` to the same next patch version.
2. Update `apps/mac/Shared (Extension)/Resources/manifest.json` to the same version.
3. Update every `MARKETING_VERSION` in `apps/mac/teak-mac.xcodeproj/project.pbxproj` to the same version and every `CURRENT_PROJECT_VERSION` to its patch number.
4. Update `apps/apple/SafariExtension/Resources/manifest.json`, `MARKETING_VERSION` in `apps/apple/project.yml`, and every `MARKETING_VERSION` in the generated `apps/apple/Teak.xcodeproj/project.pbxproj` to the same version. Leave `CURRENT_PROJECT_VERSION` alone: the Apple release workflow sets the build number from App Store Connect.
5. Run `bun install` from the repository root to synchronize `bun.lock`.
6. From `apps/raycast`, run `npm install --package-lock-only --ignore-scripts --workspaces=false` to synchronize both version fields in `package-lock.json` without traversing the Bun workspace packages.
7. From the repository root, run `bun install --frozen-lockfile` and `node scripts/release-version.mjs lockstep <version>`. Both commands must exit successfully without changing files.
8. Commit every package manifest, Mac and Apple version source, `bun.lock`, and `apps/raycast/package-lock.json` together as one scoped version change.

The preparation is complete when the working tree contains the intended version-only diff and the lockstep validator confirms every package manifest, npm lockfile, Mac version source, and Apple version source uses the target version.

Keep published version tags immutable. The `Version Tag` workflow creates the tag after the version change reaches `main`; do not create or move it manually during the normal release path.

## Public SDK publication

`SDK Release` publishes `teak-sdk` from the same next-patch lockstep tag as
the other products. Branch dispatches, mismatched tags, and commits outside
`main` are rejected. The workflow installs and exercises the packed SDK in
an independent consumer before publishing the exact tarball with provenance.
Retries verify both npm metadata and the downloaded tarball against that
artifact; only an explicit registry version 404 permits publication.

The first SDK release uses the same next-patch lockstep tag. npm requires an
existing package before configuring trust. With explicit approval, use the
isolated local npm login to stage the reviewed SDK tarball and reserve its name.
npm creates a public `0.0.0-stage` placeholder; do not approve the staged SDK
version. Configure trusted publishing for repository `praveenjuge/teak`, workflow
`sdk-release.yml`, environment `npm-sdk-release`, allowing direct publication.
Restrict that GitHub environment to version tags without required human review.
The first real release and all later releases publish automatically through OIDC with verified provenance.
No npm credential is stored in GitHub, and no token fallback is supported.

Account setup requires separate approval. See
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and
[staged publishing](https://docs.npmjs.com/staged-publishing/).

To retry, dispatch `SDK Release` on the existing immutable version tag.
An already published version passes only when its bytes match. A conflict,
registry outage, or failed verification requires investigation; never move
the tag or overwrite a published version.
