# Android app

Native Kotlin and Jetpack Compose. The app matches the iPhone app (`apps/mobile`): when you change behavior on one, check the other.

## Build and run

- One Gradle project. Use the wrapper from this directory: `./gradlew`. It needs JDK 17 or newer, and `local.properties` with `sdk.dir`.
- `./gradlew :app:installDebug` installs "Teak Dev". It talks to the shared dev deployment and WorkOS staging.
- Release builds use production. The version comes from the root `package.json`, so `bun run release:prepare` covers Android. Don't add version files here.
- Checks: `./gradlew lint testDebugUnitTest :app:assembleRelease`. CI runs the same in the `Unit Tests` workflow.

## Layout

- Modules follow Google's Now in Android sample: `app`, `core:model`, `core:data`, `core:designsystem`, `core:testing`, and one `feature:*` module per area.
- Shared build setup lives in `build-logic` convention plugins, and versions live in `gradle/libs.versions.toml`.
- Each screen's ViewModel exposes a single `StateFlow` UI state. Navigation 3 lives in `app/.../ui/TeakNavigation.kt`.
- Pure logic ported from iOS lives in `core:model`, with the same test cases. Examples: filters, card edits, Markdown blocks, save links, date search and grid rules. Port changes in both directions.

## Backend rules

- Convex calls go through `ConvexApi`, by function name. Every number argument must be a `Double`: the SDK sends `Int` and `Long` as int64, which `v.number()` rejects.
- Sign-in uses the WorkOS SDK to build the PKCE authorize URL. The code exchange and refresh are posted directly without `client_secret`, because SDK 0.4.0 always sends one and WorkOS rejects an empty one. Never log tokens.
- Sessions are encrypted with an Android Keystore key and stored in no-backup storage.
- JNA is pinned to 5.17 or newer. Convex's own JNA 5.14 can't load on 16 KB-page devices. Keep the AAR artifact type.

## Tests

- Follow `/.agents/testing.md`. Put ViewModel tests with the fakes from `core:testing` and Robolectric Compose tests in each module's `src/test`.
- Build ViewModels inside the test, not in a field initializer, so `MainDispatcherRule` applies.

## Releases

Follow `release.md` exactly.
