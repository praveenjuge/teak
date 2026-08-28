# CLI release

The npm package is `teak-cli`; the installed binary is `teak`.

Complete the shared preparation in `../../docs/agents/releases.md`, then:

1. Merge the scoped version change to `main`.
2. Let `.github/workflows/version-tag.yml` verify the patch and lockstep invariants, create `v<version>`, and dispatch `.github/workflows/cli-release.yml`.
3. The CLI workflow tests and builds the package, verifies its version, and publishes it to npm with provenance.
4. Verify the workflow succeeded and `npm view teak-cli@<version> version` returns the released version.

Do not create or move the version tag manually during the normal release path.
