<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Source layout

The web app owns all of its UI; nothing under `src` is shared with another workspace. The browser extension keeps its own copies of the button, wordmark and theme tokens, and pure helpers that several surfaces need (web, docs, extension, native ports) live in `packages/convex/shared`.

`src` is grouped by kind of file. Put new code in the folder that fits, and keep a feature's pieces together inside it.

| Folder | What goes there |
| --- | --- |
| `app/` | Routes, layouts and route handlers. Keep pages thin: they render a screen or compose components. |
| `screens/` | Page-level views that routes render: `CardsScreen`, `TagsScreen`, `SettingsShell`. |
| `components/ui/` | shadcn new-york primitives. Add them with the shadcn CLI (`components.json`). |
| `components/<feature>/` | One folder per area: `cards`, `card-modal`, `card-previews`, `search`, `sidebar`, `settings`, `text-editor`, and so on. Where a folder has an `index.ts`, import it through that from outside the folder. |
| `components/app-shell/` | The signed-in frame: the shell, its loading skeletons, `IntentLink` and the WebMCP tools. |
| `components/providers/` | Providers and auth gates that layouts mount: WorkOS, Convex, PostHog and theme. |
| `components/feedback/` | Loading, empty, error and retry states that screens share. |
| `components/` (root) | Standalone pieces used across areas: `Logo`, `StatusScreen`, `JsonLd`, `lazyDialogs`. |
| `hooks/` | React hooks (`use*`), including the card, search, upload and settings controllers. A hook that calls Convex keeps its testable core beside it: `useFileUpload.ts` wires `useFileUploadCore.ts`, and `useCardActions.ts` wires `cardActions.ts`. |
| `lib/` | Helpers and modules without UI: URL and search state, keyboard shortcuts, the cached Convex query hooks (`convexQueryHooks.ts`), file uploads (`upload/`: transport, multipart and media metadata), auth, session and security headers. |
| `constants/` | Static values: billing plans, settings and toast ids. |
| `styles/` | `theme.css` (design tokens and app-wide CSS), `typeset.css` (prose) and the SN Pro fonts that `app/layout.tsx` loads. `app/globals.css` imports them. |

- Import with the `@/` alias when you leave a feature folder; relative imports are for files in the same folder or its `__tests__`.
- Tests live in a `__tests__` folder beside the code they cover. `src/__tests__` holds route, `next.config.ts` and cross-cutting wiring tests. `bun run test` runs each file in its own Bun process, because tests register happy-dom and module mocks globally.
