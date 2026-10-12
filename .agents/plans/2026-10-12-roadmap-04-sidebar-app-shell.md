## Goal

Give the web app a sidebar shell with routed views (All, Favorites, Archive, Trash) and empty slots for Folders and Tags, collapsible on desktop and a drawer on phones. This is the frame Phases 5, 6, 8 and 9 hang off. Phase 4 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 3](2026-10-12-roadmap-03-archive-bulk-actions.md) (the Archive view replaces its temporary "Archived" pill).

## Success Criteria

- `/`, `/favorites`, `/archive` and `/trash` each render the library in that view, with the active item highlighted in the sidebar and correct back/forward behavior.
- The sidebar collapses to icons on desktop (state remembered per device) and becomes a drawer under the `md` breakpoint, opened from a header button.
- Typing `fav` or `trash` in search navigates to `/favorites` or `/trash` instead of toggling hidden state.
- Settings, sign-in and the card modal (`?card=`) look and behave exactly as before.

## Context And Current Facts

- `packages/ui/src/components/ui/` has `alert, avatar, badge, button, card, checkbox, confirm-dialog, context-menu, dialog, dropdown-menu, input, label, progress, select, separator, skeleton, sonner, spinner, table, tabs, textarea`. No `sheet`, `tooltip`, `popover`, `command` or `switch`. `components.json` is shadcn new-york with lucide icons.
- New dependencies: `sheet` reuses `@radix-ui/react-dialog` (installed); `tooltip`, `popover` and `switch` need `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, `@radix-ui/react-switch`; `command` needs `cmdk`. Pin exact versions in `packages/ui/package.json`.
- `max-w-7xl` is at `apps/web/src/app/layout.tsx:44` (`<main className="mx-auto max-w-7xl px-4 pb-10">`), not line 22. It wraps every page, including sign-in and settings.
- `apps/web/src/app/(app)/layout.tsx` wraps children in `Suspense` + `AuthenticatedAppProvider`; `(app)/page.tsx` renders `HomePageClient` with `export const instant = false`; `(app)/settings/layout.tsx` uses `SettingsShell` from `@teak/ui/screens`.
- Quick commands: `resolveQuickSearchCommand` (`packages/convex/shared/search/constants.ts`) maps `fav`, `favs`, `favorites`… and `trash`, `bin`, `deleted`… to toggles of `showFavoritesOnly` / `showTrashOnly` in `useCardsSearchController`.
- Nothing in `packages/ui/src` uses `localStorage` today; the collapse state needs a small guarded helper (try/catch, SSR-safe).
- `packages/tests/src/web/settings-layout-stability.e2e.ts` and `settings-navigation.e2e.ts` cover the settings layout and must stay green after `max-w-7xl` moves.

## Constraints And Non-goals

- Web only; no Convex change, no schema change, no API change.
- Shared UI in `packages/ui` (sidebar, primitives); routes and URL handling in `apps/web`.
- No folders or tags content yet: the sidebar exposes named slots that render nothing until Phases 5 and 6.
- No new visual language: sidebar uses existing muted backgrounds, `text-sm`, lucide icons, `tw-animate-css` for the drawer.

## Backend

- None.

## Web

- `packages/ui/src/components/ui/`: add shadcn `sheet.tsx`, `tooltip.tsx`, `popover.tsx`, `command.tsx`, `switch.tsx`.
- `packages/ui/src/components/sidebar/AppSidebar.tsx`: nav items All (`LayoutGrid`), Favorites (`Heart`), Archive (`Archive`), Trash (`Trash2`); `foldersSlot` and `tagsSlot` props; Settings link at the bottom; collapsed mode shows icons with tooltips; under `md` renders inside `Sheet`.
- `apps/web/src/app/layout.tsx`: remove `max-w-7xl` from `<main>`; settings and sign-in keep their own width wrappers.
- `apps/web/src/app/(app)/layout.tsx`: render the shell (sidebar + content column with the old width) around library routes; settings keeps `SettingsShell`.
- Routes `(app)/favorites/page.tsx`, `(app)/archive/page.tsx`, `(app)/trash/page.tsx` render `HomePageClient view="favorites" | "archive" | "trash"`; `HomePageClient` passes `view` into the search controller instead of hidden toggles.
- Quick commands navigate (`router.push("/favorites")`) and clear the input.

## API / MCP / SDK / CLI

- None.

## Docs

- `features.mdx`: "Trash" and "Archive" mention the sidebar; quick view tokens now open the matching page.
- Ship-month changelog: "A sidebar for Favorites, Archive and Trash".

## UI states

- Empty: each view's empty copy is one sentence (for example Trash: "Trash is empty."); no illustration.
- Loading: the sidebar renders immediately (static); the content column shows the skeleton grid.
- One item / many items: no counts in the sidebar for now (counts arrive with folders and tags where they help).
- Very long names: not applicable yet; slots must truncate their future rows.
- Error: a failed library query shows the existing error state in the content column; the sidebar stays usable.
- Rate-limited: not applicable.
- UI bar: 150–200ms drawer open; focus moves into the drawer and returns to the trigger; Esc closes; active item has `aria-current="page"`; collapsed tooltips; correct at 390px, 768px and 1440px, light and dark.

## Scenario seed packs

- None new; reuse `archive-mix` from Phase 3 so every view has content, and an empty account for the empty states.

## Break-it checklist

- UI: rapid clicks between views; back/forward across four views and an open card; reload on `/archive?card=…`; toggle collapse then reload; open and close the drawer with keyboard only at 390px; rotate a tablet between 768px and 1024px; type `fav` then press back; dark mode.
- Backend: not applicable; confirm no extra Convex subscriptions are opened per route change (watch the dev dashboard).

## Tests

- `packages/ui/src/components/sidebar/__tests__/AppSidebar.test.tsx`: marks the active route with `aria-current`, renders slots, collapsed mode keeps accessible names.
- `packages/ui/src/hooks/__tests__/useCardsSearchController.test.ts`: `fav`/`trash` emit a navigation intent instead of toggling.
- `packages/tests/src/web/sidebar-navigation.e2e.ts`: navigate All → Favorites → Archive → Trash; back/forward; 390px drawer open, navigate, closes.
- Existing `settings-layout-stability.e2e.ts` and `settings-navigation.e2e.ts` stay green.

## Proof before the PR

- Video: navigate all four views, collapse and reload, open a card in Archive, use `fav` in search, then the 390px drawer with keyboard only.
- Screenshots: expanded and collapsed sidebar; drawer at 390px; each view empty and populated; settings page unchanged; light and dark; 390px, 768px and 1440px.

## Release gate

1. Narrow tests above, then the repo checks and `sidebar-navigation.e2e.ts`, `settings-layout-stability.e2e.ts`, `02-web-journey.e2e.ts`, `08-a11y.e2e.ts`.
2. Run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy web only. Smoke-test production: each route loads signed in, `/archive` redirects to sign-in when signed out.

## Risks And Open Questions

- Moving `max-w-7xl` touches every page; compare settings and sign-in screenshots before and after.
- Does `/trash` need its own sort (by `deletedAt`, using Phase 2's `by_user_deleted_deletedAt`)? Proposed: yes, newest deleted first.
