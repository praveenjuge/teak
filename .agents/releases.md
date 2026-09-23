# Shared release preparation

Every Teak product release starts from one next-patch version change. The
preferred path is one command from the repository root:

```bash
bun run release:prepare <version>
```

It validates the next patch, updates every tracked `package.json`, the Safari
WebExtension manifest, and the Safari Xcode marketing/build versions,
synchronizes `bun.lock` (and `apps/raycast/package-lock.json` when present),
then verifies with a frozen install and the lockstep validator. Review the
diff and commit every package manifest and lockfile together as one scoped
version change. The command is resume-safe: if a run fails partway, re-run
it with the same version plus `--resume` to continue from the install step.

Manual fallback (same steps the script performs):

1. Update the `version` field in every tracked `package.json` to the same next patch version.
2. Update `apps/safari-extension/Shared (Extension)/Resources/manifest.json` to the same version.
3. Update every `MARKETING_VERSION` in `apps/safari-extension/teak-safari.xcodeproj/project.pbxproj` to the same version and every `CURRENT_PROJECT_VERSION` to its patch number.
4. Run `bun install` from the repository root to synchronize `bun.lock`.
5. From `apps/raycast`, run `npm install --package-lock-only --ignore-scripts --workspaces=false` to synchronize both version fields in `package-lock.json` without traversing the Bun workspace packages.
6. From the repository root, run `bun install --frozen-lockfile` and `node scripts/release-version.mjs lockstep <version>`. Both commands must exit successfully without changing files.
7. Commit every package manifest, Safari version source, `bun.lock`, and `apps/raycast/package-lock.json` together as one scoped version change.

The preparation is complete when the working tree contains the intended version-only diff and the lockstep validator confirms every package manifest, npm lockfile, and Safari version source uses the target version.

Keep published version tags immutable. The `Version Tag` workflow creates the tag after the version change reaches `main`; do not create or move it manually during the normal release path.
