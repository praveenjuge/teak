# CLI release

The npm package is `teak-cli`; the installed binary is `teak`.

The canonical release trigger is the same next-patch lockstep `package.json` bump used by every Teak surface:

1. Update every tracked `package.json` to the same next patch version and synchronize `bun.lock`.
2. Merge the scoped version change to `main`.
3. Let `.github/workflows/version-tag.yml` verify the patch and lockstep invariants, create `v<version>`, and dispatch `.github/workflows/cli-release.yml`.
4. The CLI workflow tests and builds the package, verifies its version, and publishes it to npm with provenance.
5. Verify the workflow succeeded and `npm view teak-cli@<version> version` returns the released version.

Do not create or move the version tag manually during the normal release path.
