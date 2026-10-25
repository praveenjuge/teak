## Goal

Bring the native apps and the web up to the same feature set and wording, where each feature makes sense for the platform, in 5 phases. Each phase is one PR. The ideas came from a review of every client on 2026-10-24 (web, iPhone, iPad, Mac, Android, the browser extension, Raycast, the CLI, the API, MCP and SDK, and save by email). On the same day the owner picked which ideas to build; those answers are the decisions below.

## Phases

| # | Plan | Surfaces | One PR that… |
|---|---|---|---|
| 1 | Native languages and shared wording (done; see `translating.mdx`, "Native apps") | Apple, Android, i18n, Raycast and Safari labels | ships the 8 languages on Apple and Android from `packages/i18n`, adds Settings → Language, the system per-app language, and one word for each action everywhere |
| 2 | [Native notes and search](./2026-10-24-parity-02-native-notes-search.md) | Apple, Android | shows tables, ticks task checkboxes, adds the `[[` card picker, and makes `-`, `OR`, `( )` and `site:` work and get suggested |
| 3 | [Native cards and library](./2026-10-24-parity-03-native-cards-library.md) | Convex, web, Apple, Android | adds Empty Trash everywhere, and closes the card and library gaps: smart-folder search on Apple, link title and URL, Keep for AI tags, Undo after Trash, media controls, Android's tablet rail and wallpaper colors |
| 4 | [Apple system integration](./2026-10-24-parity-04-apple-system.md) | Apple | adds Search, Open card and Add to folder intents, Spotlight, Control Center controls and the Action button, and a folder picker in the share extension |
| 5 | [Web install and share target](./2026-10-24-parity-05-web-install.md) | web | makes the web app installable and a share target, without offline support |

Order: phase 1 first, because phases 2–4 add native text and that text goes into the catalogs phase 1 creates (`packages/i18n/messages/native/*.json`, read with `tr` on Apple and `tr`/`UiText` on Android). Phases 2, 3 and 4 then go in any order. Phase 5 doesn't depend on any other phase and can ship whenever.

## Decisions (from the 2026-10-24 Q&A)

| Topic | Decision |
|---|---|
| Rule for every feature | Same features and the same look as the web, but only where the feature fits the platform. Don't add everything everywhere |
| Native shared gaps | Yes: languages, search operators, tables and checkboxes, the `[[` picker, quote and palette cards, the smaller card gaps, media viewing |
| Native settings | **No** devices list, **no** export, **no** save-by-email settings on Apple or Android. They stay on the web |
| Apple | Yes: App Intents (Search, Open card, Add to folder) with card entities and Spotlight; a folder picker in the share extension; Control Center controls and the Action button for Voice memo and New note |
| Android | Yes: per-app language in system settings; Material You wallpaper colors as an option, off by default; Favorites, Archive and Trash in the navigation rail on wide screens, chips kept on phones |
| Web | Yes: a web app manifest and Web Share Target. No offline support |
| Wording | Yes: one word for each action on every client ("Sign out", the done labels, "Refresh details") |
| Not chosen | Widgets on Apple and Android, Quick Look, the Android Quick Settings tile, tablet keyboard shortcuts, a folder picker in Android's share sheet, `navigator.share` on the web, and every extension, Raycast, CLI, API, MCP and email idea. Not doing these unless the owner adds them |
| PRs | One PR per phase, ideas combined as much as possible |
| Proof | Every PR carries proof as a private artifact page (screenshots, videos, captured output) linked under the PR's Proof section, as `.agents/pull-requests.md` says |

## Corrections to the 2026-10-24 idea list

The facts were checked after the Q&A. Four ideas in the list were wrong about today's code:

- **Empty Trash isn't on the web.** "Trash is empty." is only the empty-state text (`apps/web/src/screens/CardsScreen.tsx:110`). No such action or mutation exists; Apple and Android delete selected cards one by one. Phase 3 adds it to all three as one new feature. The owner can drop it from phase 3 without affecting the rest.
- **Android already searches with `-`, `OR` and parentheses.** It sends the typed text as `searchQuery`, and the backend parses it. Only Apple strips them. Android drops the whole query when it contains a date word. Phase 2 fixes both.
- **Quote and palette cards from native notes probably work already.** Native sends no `cardType` for plain text, so `createCard` detects a quote and the processing pipeline detects a palette, as on the web. Phase 2 proves this rather than building it.
- **Apple already has an in-app PDF viewer** (PDFKit in `CardPreviews.swift`), and Android already zooms images. Phase 3 only fills the remaining media gaps.

## Rules every phase follows

- **Process:** read `AGENTS.md`, "Rules every change keeps" in `architecture.mdx`, and the nested `AGENTS.md` of every workspace the phase touches.
- **Backend changes:** follow `adding-a-feature.mdx`. Deploy Convex before releasing native clients, and keep the shipped apps working against the new backend without an update.
- **Port between apps:** Apple's `AGENTS.md` asks that TeakCore logic changes go to Android too. Each phase changes both apps in the same PR when the feature is on both.
- **Text:** from phase 1 on, every new native string goes into all 8 catalogs in `packages/i18n` in the same PR, as `translating.mdx` says.
- **Proof:**
  - Cover iPhone, iPad and Mac for Apple, and phone and tablet emulators for Android.
  - Include light and dark, and the empty, loading, populated and error states the change touches.
  - Drive each touched feature through `.agents/skills/verify-teak/` and update `features/apple.md`, `features/android.md` and the others in the same PR.
  - Publish the evidence as a private artifact page and link it under Proof. Never commit screenshots.
- **Where native work can run:** the Apple and Android apps need a Mac with Xcode 27 or the Android SDK. Cloud sessions have neither, so phases 1–4 run on the owner's Mac or a VM that has them. Phase 5 runs anywhere.
- **Releases:** native changes ship through `.agents/releases.md`, then `apps/apple/release.md` and `apps/android/release.md`, as one next-patch version in lockstep.
- **Docs:** `apps/docs` describes each change in the PR that ships it, following `apps/docs/AGENTS.md`.
- **Finishing:** delete each phase plan in the PR that finishes it, and delete this roadmap with the last phase.
