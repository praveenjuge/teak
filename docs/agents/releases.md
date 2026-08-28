# Shared release preparation

Every Teak product release starts from one next-patch version change. Complete this preparation before following a product runbook:

1. Update the `version` field in every tracked `package.json` to the same next patch version.
2. Run `bun install` from the repository root to synchronize `bun.lock`.
3. From `apps/raycast`, run `npm install --package-lock-only --ignore-scripts` to synchronize both version fields in `package-lock.json`.
4. From the repository root, run `bun install --frozen-lockfile` and `node scripts/release-version.mjs lockstep <version>`. Both commands must exit successfully without changing files.
5. Commit every package manifest, `bun.lock`, and `apps/raycast/package-lock.json` together as one scoped version change.

The preparation is complete when the working tree contains the intended version-only diff and the lockstep validator confirms every package manifest and npm lockfile uses the target version.

Keep published version tags immutable. The `Version Tag` workflow creates the tag after the version change reaches `main`; do not create or move it manually during the normal release path.
