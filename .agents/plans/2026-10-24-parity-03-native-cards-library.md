## Goal

Close the remaining card and library gaps between web, Apple and Android in one PR:

- Empty Trash on all three.
- Edit a smart folder's search on Apple.
- Edit a link's title and address.
- Keep or remove AI tags from the card view.
- Undo after moving a card to Trash.
- Image zoom and audio seeking.
- An in-app PDF viewer on Android.
- Favorites, Archive and Trash in Android's tablet navigation rail.
- Wallpaper colors (Material You) as an Android option.

Roadmap: [parity roadmap](./2026-10-24-parity-00-roadmap.md), phase 3. One PR. It comes after phase 1, so all new text goes into the catalogs.

## Success criteria

- **Empty Trash:**
  - Trash on the web, Apple and Android has an **Empty Trash** action. It is disabled when Trash is empty and asks for confirmation with the count.
  - It permanently deletes every card in Trash, including more than one page of them. The other clients update live.
  - There's no Undo, so the confirmation says so.
- **Smart folders:** Apple's folder menu has **Edit search…**, as on the web and Android. Saving changes the folder's results.
- **Link title:** a link's title is editable on Apple and Android, as on the web, and shows on every client.
- **Link address:** a link card's address is editable on the web, Apple and Android. Saving refreshes the preview, as the backend already does.
- **AI tags:** the card view shows Teak's suggested tags with **Keep** and **Remove** on Apple and Android, matching the web's card details panel.
- **Undo after Trash:** moving one card to Trash shows **Undo** on Apple (library, context menu and card view) and in the web grid's toast, matching the web card modal and Android.
- **Media:**
  - Apple: an image opens full screen with pinch and double-tap zoom.
  - Apple and Android: audio has a seek bar, like the web's.
- **Android PDF:** Android opens PDFs in the app, page by page, with "Open in another app" kept.
- **Android tablet rail:** on screens with an expanded width, the rail lists Home, Favorites, Archive, Trash, Folders, Add and Settings. Phones keep the bottom bar and the Favorites, Archive and Trash chips.
- **Android wallpaper colors:** Settings → Appearance has **Wallpaper colors**, off by default. Turning it on recolors the app from the wallpaper in light and dark. Teak's red stays the default.

## Context and current facts

- **Permanent delete:**
  - `cards:permanentDeleteCard({id})` (`packages/convex/card/deleteCard.ts:22`) calls `permanentDeleteCardForUserHandler`.
  - `bulkUpdateCards` (`card/bulkActions.ts:22-33`) has no permanent delete.
  - Apple (`LibraryModel.swift:399-420`) and Android (`LibraryViewModel.kt:370`) loop over selected cards one by one.
  - The web has no Empty Trash; `emptyTrash` in `en.json:1331` is only the empty-state text.
- **Smart folders:**
  - `folders:updateFolder({folderId, name?, color?, query?})` (`folder/folders.ts:581`). `query` is allowed only for smart folders (`:396`).
  - The web uses it in `FolderNameDialog.tsx:135-140`, and Android in `FoldersScreen.kt:182,214-243`.
  - Apple's `FoldersModel.rename` sends only `name` (`FoldersModel.swift:48-51`).
- **Link fields:**
  - `updateCardField` supports `metadataTitle` (`card/updateCard.ts:418`) and `url` (`:384`, which resets the preview and reruns processing).
  - The web edits the title inline in the modal header (`CardModal.tsx:923-945`). It has an `updateUrl` hook (`useCardModal.ts:384`) but no UI uses it.
  - Apple's and Android's `CardFieldChange` cover only content, notes, tags and removeAiTag (`TeakCore/.../CardGrid.swift:82-95`, `core/model/.../CardEdit.kt:3-8`).
- **AI tags:**
  - The web's `SuggestedTags` (`CardMetadataPanel.tsx:533-538`) offers Keep, which writes the tags field plus the AI tag, and Remove (`field: "removeAiTag"`).
  - Native offers Remove only, inside Edit (Apple `CardEditView.swift:119-126`, Android `CardEditScreen.kt:212-213`). Its card views show AI tags as read-only chips.
- **Undo:**
  - The web modal's Trash toast has Undo through `updateCardField field: "restore"` (`useCardModal.ts:607-622`). The grid's toast doesn't (`hooks/cardActions.ts:98`).
  - Apple trashes without Undo (`LibraryModel.swift:224-229`, `CardDetailModel` `:159-161`), although `show(_:undo:)` exists (`LibraryModel.swift:190`).
- **Media:**
  - Apple's image preview is static (`CardPreviews.swift:38-66`), and its audio has no seek (`:156-261`). Apple already has a PDFKit viewer (`:263-339`).
  - Android already zooms images (`CardMedia.kt:157-178`), but its audio has no seek (`:278-350`), and its PDFs open in a Custom Tab (`CardDetailScreen.kt:480-481`).
  - The web's audio has a seek bar (`AudioPreview.tsx:130`) and no speed control.
- **Android shell:**
  - `NavigationSuiteScaffold` with `Tab {Home, Folders, Add, Settings}` (`app/.../ui/TeakNavigation.kt:57-62,103-116`). There is no window-size branching.
  - The chips are in `LibraryChrome.kt:212-246`.
  - Theme: `TeakTheme` → `MaterialExpressiveTheme` with fixed schemes (`core/designsystem/.../theme/Theme.kt`, `Color.kt`).
  - Preferences: `ThemePreference` in DataStore (`core/data/.../prefs/PreferencesRepository.kt:18-47`).
  - minSdk 31, so dynamic color is always available.

## Decisions

- **Empty Trash backend:**
  - A new public mutation `cards:emptyTrash` with no arguments. It returns `{count}` and schedules an internal paged mutation that hard-deletes the account's trashed cards with `permanentDeleteCardForUserHandler`, one page per run, until none are left.
  - It only deletes cards trashed before the call: it records the start time and skips cards trashed after it.
  - It is rate-limited like other destructive actions.
  - Not added to the public API, MCP or CLI in this phase. `cards delete --permanent` already covers scripts.
- **Empty Trash UI:**
  - Web: a button in Trash's header and the command palette.
  - Apple: the Trash view's toolbar and the More menu.
  - Android: the Trash chip's view (phone) and the Trash rail page (tablet).
- **Smart-folder search on Apple:** reuse the folder name sheet with a query field, as Android does. Validation errors come from `updateFolder` codes, translated.
- **Link editing:**
  - Title: inline in the card view header on Apple and Android, as on the web.
  - Address: an **Edit link…** item in the card's More menu on all three. It opens a field prefilled with the address, saves through `updateCardField url`, and shows that the preview will refresh.
  - Non-URLs are refused client-side with the same message the server sends.
- **AI tags:** a "Suggested by Teak" row in the card view's tags section on Apple and Android, with Keep and Remove per tag, matching the web. Remove stays in Edit too.
- **Undo after Trash:**
  - Apple: Undo restores with `updateCardField restore`.
  - The web grid's toast gets the same Undo as the modal.
  - The confirmation before trashing one card is removed on Apple, since Undo replaces it. It stays for Delete forever.
- **Media:**
  - Apple image: tap opens a full-screen viewer with pinch, double-tap and swipe-down to close; on Mac it opens a zoomable window.
  - Audio seek: a draggable bar on Apple and Android, matching the web. No speed control, since the web has none.
  - Android PDF: an in-app viewer with `PdfRenderer` in a lazy column, keeping "Open in another app".
- **Android rail:**
  - When the window width class is Expanded, the rail shows Home, Favorites, Archive, Trash, Folders, Add and Settings.
  - Favorites, Archive and Trash open the library with that filter as a fixed view, and their chips are hidden there.
  - Compact and Medium widths keep today's four tabs and the chips.
- **Wallpaper colors:** `ThemePreference` gains a separate boolean `useWallpaperColors` (default false). `TeakTheme` uses `dynamicLightColorScheme`/`dynamicDarkColorScheme` when it's on.

## Work

1. **Convex:** `card/emptyTrash.ts` (the mutation and the internal pager), tests, and the rate-limit entry. Add `ConvexFunctions` entries on both apps.
2. **Web:**
   - The Empty Trash button, confirmation and toast, plus the command palette action.
   - **Edit link…** in the card menu and modal.
   - Undo in the grid's Trash toast.
3. **Apple:**
   - Empty Trash, Edit search…, title and link editing, AI tag Keep, Trash Undo.
   - The image viewer and the audio seek bar.
4. **Android:**
   - Empty Trash, title and link editing, AI tag Keep.
   - The audio seek bar and the PDF viewer.
   - The expanded rail and the wallpaper colors setting.
5. **Catalogs:** every new label in all 8, including web keys.
6. **Docs:**
   - `features.mdx` → Trash (Empty Trash), Link cards (Edit link), Card details (Suggested by Teak).
   - `mobile.mdx` (rail, wallpaper colors).
7. **Verify recipes:**
   - `card-actions.md` gets `empty-trash` and `edit-link`.
   - `apple.md` and `android.md` get the matching sub-features, plus `android-rail` and `android-wallpaper-colors`.

## Tests

- **Convex:** `emptyTrash` deletes every trashed card across pages, skips cards trashed after the call, leaves non-trashed cards alone, refuses when signed out, and cleans storage like `permanentDeleteCard`.
- **Web:**
  - Unit tests for the Empty Trash button state and the grid Undo.
  - `packages/tests` journey: trash 2 cards, Empty Trash, Trash shows its empty state.
- **Apple and Android unit tests:**
  - Link-field validation, the AI tag Keep payload and the Trash Undo payload.
  - The rail item list by width class (Android).
  - The theme picks dynamic schemes only when the setting is on (Android).

## Proof (private artifact page, linked under Proof)

- **Empty Trash:**
  - Videos on web, iPhone and Android: trash cards, Empty Trash, confirm, and Trash is empty on the other clients live.
  - Captured Convex output for a run that needed more than one page.
- **Card view, Apple and Android, light and dark:**
  - Screenshots before and after for the title edit, Edit link…, "Suggested by Teak" with Keep, and the Undo toast.
  - The web's Edit link… at 390 and 1440 px.
- **Smart folders:** a Mac video of Edit search… changing a smart folder's results.
- **Media:**
  - An iPhone video of the image zoom viewer.
  - Audio seeking on iPhone and Android.
  - Android's in-app PDF viewer on the phone and the tablet.
- **Android shell:**
  - Tablet screenshots of the new rail on each of its pages.
  - Phone screenshots showing the bottom bar and chips unchanged.
  - Wallpaper colors on and off with two different wallpapers.

## Release gate

1. Run `bun run check`, the Convex tests, both local app builds and `bunx e2e run` for the new journey.
2. Deploy Convex, then the web. Then release Apple and Android at one lockstep version. The shipped apps keep working, since nothing they call changes.
3. Production smoke test: Empty Trash on a seeded test account (never the owner's real Trash without asking), and edit a link on each client.

## Risks and open questions

- **Size:** this is the widest PR in the roadmap. Commit per client (Convex, web, Apple, Android) so review can go one commit at a time.
- **Empty Trash is irreversible:** the confirmation states the count and that it can't be undone. The owner can drop the feature from this phase without affecting the rest.
- **Open:** whether Empty Trash should also be in the public API, MCP and CLI. Default: not now.
- **Open:** whether editing a link's address should keep the old AI summary and tags. Default: no. The backend reruns processing, as it does today.
