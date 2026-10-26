# Apple app (iPhone, iPad, Mac)

Native SwiftUI. One multiplatform app target, a share extension and a Safari web extension, all for iOS and macOS. It replaced the Expo iPhone app and Teak for Mac.

## Build and run

- Xcode 27 (Swift 6.4). The project is generated: edit `project.yml`, then run `scripts/generate-project.sh` and commit `Teak.xcodeproj` with it. CI fails when they differ.
- Debug talks to the shared dev deployment and WorkOS staging; Release talks to production. The Convex Rust core is Apple silicon only, so Mac and Simulator builds are arm64.
- This workspace has no `package.json`: `bun run --filter`, `bun run dev` and `doctor` don't see it.
- CI and releases run on GitHub's `xcode-27` runner image (a preview label) with Xcode pinned by `scripts/select-xcode.sh`; keep that pin in step with the Xcode you develop on.
- Checks: `swift test --package-path Packages/TeakKit` and `bun --no-env-file test apps/apple/tests/` (from the repo root). CI does not build the app, so build it locally for iPhone and Mac before pushing app changes.

## Layout

- `Packages/TeakKit`: `TeakCore` (Foundation only: models, ported logic, WorkOS session, Convex over HTTPS, uploads, share import), `TeakSync` (the live Convex client; app only), `TeakUI`.
- `Teak/`: the app. `App` (scenes, routing, commands), `Features/{Auth,Library,Card,Capture,Settings}`, `Platform/macOS` (menu bar, Quick Capture, hotkey, Services), `Intents`.
- `ShareExtension/`, `SafariExtension/` (native handler plus the popup in `Resources`).

## Rules

- Convex calls go through `ConvexFunctions` (TeakCore), which binds each function name to its result type; arguments are `ConvexArgs`, and every number is a `Double` (`v.number()` rejects int64).
- The session lives in the shared keychain group; refreshes take the cross-process lock in the app group, because WorkOS rotates refresh tokens. Never log tokens.
- Hold a file lock in the app group only inside `BackgroundActivity` time, as `FileCredentialLock` does: iOS kills a process suspended while holding one (`0xdead10cc`).
- Shared backend constants come from `Packages/TeakKit/Sources/TeakCore/Resources/SharedConstants.json`. Regenerate it with `bun --no-env-file run apps/apple/scripts/shared-constants.ts --write`; `apps/apple/tests/shared-constants.test.ts` fails when it drifts.
- Pure logic in `TeakCore` shares its test cases with Android's `core:model`. Port behavior changes to Android too (`apps/android/AGENTS.md`).
- SF Rounded everywhere (`.fontDesign(.rounded)` at the root), Teak red only for meaning, system components first.
- Keyboard shortcuts must not collide with system ones: UIKit throws on duplicate menu shortcuts.

## Tests

- Follow `apps/docs/content/docs/(open-source)/testing.mdx`. Swift Testing in `Packages/TeakKit/Tests`.
- Swift Testing runs suites in parallel and `AppLanguage` is one value per process, so every suite takes `.english` or, if it changes the language, `.switchesLanguage` (`Tests/TeakCoreTests/Language.swift`). Pass localized text to `@Test(arguments:)` as a closure: arguments are evaluated before the trait applies. `apps/apple/tests/teakkit-language.test.ts` fails on a test without one. The lock puts back the language saved in the app group whenever no suite holds it.
- UI flows run against this checkout's local E2E stack: start `bun run --cwd packages/tests e2e:stack`, then `scripts/ui-tests.sh ios|ipad|mac`. Each test signs in as a fresh WorkOS emulator user; Debug builds read the stack's URLs and a test session from launch environment variables (compiled out of Release).
- For a manual run against the stack, `bun --no-env-file run apps/apple/scripts/e2e-session.ts` prints that launch environment.
- Mac UI tests need UI automation allowed on the machine (`automationmodetool`), so CI runs iPhone and iPad.

## Releases

Follow `release.md` exactly.
