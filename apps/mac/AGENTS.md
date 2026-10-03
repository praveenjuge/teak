# Mac app conventions

This workspace has no `package.json`: it is invisible to Turbo, `bun run dev`,
and `doctor` by design. Local runs happen in Xcode (`teak-mac.xcodeproj`):
open the project and build the `teak-mac (macOS)` scheme.

Runnable checks without signing, from the repository root:

- `bun test apps/mac/tests/companion.test.ts`
- `bash scripts/test-mac-oauth.sh` (compiles and runs the Swift OAuth tests)
- `xcodebuild -list -project apps/mac/teak-mac.xcodeproj`

For a release, read `release.md` completely and follow its canonical sequence.
