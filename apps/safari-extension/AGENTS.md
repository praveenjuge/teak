# Safari extension conventions

This workspace has no `package.json`: it is invisible to Turbo, `bun run dev`,
and `doctor` by design. Local runs happen in Xcode (`teak-safari.xcodeproj`):
open the project and build the `teak-safari (macOS)` scheme.

Runnable checks without signing, from the repository root:

- `bun test apps/safari-extension/tests/companion.test.ts`
- `bash scripts/test-safari-oauth.sh` (compiles and runs the Swift OAuth tests)
- `xcodebuild -list -project apps/safari-extension/teak-safari.xcodeproj`

For a release, read `release.md` completely and follow its canonical sequence.
