# Apple app (iPhone, iPad, Mac)

Native SwiftUI. One multiplatform app target, a share extension and a Safari web extension, all for iOS and macOS. It replaces `apps/mobile` (Expo, frozen) and `apps/mac`.

## Build and run

- Xcode 27 (Swift 6.4). The project is generated: edit `project.yml`, then run `scripts/generate-project.sh` and commit `Teak.xcodeproj` with it. CI fails when they differ.
- Debug talks to the shared dev deployment and WorkOS staging; Release talks to production. The Convex Rust core is Apple silicon only, so Mac and Simulator builds are arm64.
- This workspace has no `package.json`: Turbo, `bun run dev` and `doctor` don't see it.
- Checks: `swift test --package-path Packages/TeakKit`, `bun --no-env-file test apps/apple/tests/` (from the repo root), and the builds in the `Unit Tests` workflow.

## Layout

- `Packages/TeakKit`: `TeakCore` (Foundation only: models, ported logic, WorkOS session, Convex over HTTPS, uploads, share import), `TeakSync` (the live Convex client; app only), `TeakUI`.
- `Teak/`: the app. `App` (scenes, routing, commands), `Features/{Auth,Library,Card,Capture,Settings}`, `Platform/macOS` (menu bar, Quick Capture, hotkey, Services), `Intents`.
- `Shared/`: sources compiled into the app and both extensions.
- `ShareExtension/`, `SafariExtension/` (native handler plus the popup in `Resources`).

## Rules

- Convex calls go by function name with `ConvexArgs`; every number is a `Double` (`v.number()` rejects int64).
- The session lives in the shared keychain group; refreshes take the cross-process lock in the app group, because WorkOS rotates refresh tokens. Never log tokens.
- Shared backend constants come from `Packages/TeakKit/Sources/TeakCore/Resources/SharedConstants.json`. Regenerate it with `bun --no-env-file run apps/apple/scripts/shared-constants.ts --write`; `apps/apple/tests/shared-constants.test.ts` fails when it drifts.
- Pure logic is ported from `apps/mobile/lib` and the Mac app with the same test cases. Port behavior changes to Android too (`apps/android/AGENTS.md`).
- SF Rounded everywhere (`.fontDesign(.rounded)` at the root), Teak red only for meaning, system components first.
- Keyboard shortcuts must not collide with system ones: UIKit throws on duplicate menu shortcuts.

## Tests

- Follow `/.agents/testing.md`. Swift Testing in `Packages/TeakKit/Tests`.
- UI flows run against this checkout's local E2E stack: start `bun run --cwd packages/tests e2e:stack`, then `scripts/ui-tests.sh ios|ipad|mac`. Each test signs in as a fresh WorkOS emulator user; Debug builds read the stack's URLs and a test session from launch environment variables (compiled out of Release).
- For a manual run against the stack, `bun --no-env-file run apps/apple/scripts/e2e-session.ts` prints that launch environment.
- Mac UI tests need UI automation allowed on the machine (`automationmodetool`), so CI runs iPhone and iPad.

## Releases

Follow `release.md` exactly.
