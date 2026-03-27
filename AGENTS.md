Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

## Quick Commands

```bash
# Install dependencies
bun install

# Dev (web + convex backend)
bun run dev

# Individual services
bun run dev:web        # Next.js web + Convex
bun run dev:convex     # Convex backend only
bun run dev:api        # Hono API gateway
bun run dev:mobile     # Expo mobile app
bun run dev:desktop    # Tauri desktop app
bun run dev:extension  # Browser extension + Convex
bun run dev:raycast    # Raycast extension
bun run dev:docs       # Documentation site

# Build/package extensions
bun run build:extension
bun run build:raycast
bun run publish:raycast
bun run zip --filter @teak/extension

# Production build / start
bun run build
bun run start

# Lint & Typecheck
bun run lint
bun run typecheck

# Tests
bun run test

# Quality checks (Ultracite)
bun run check
bun run fix

# Pre-commit (same as git hook)
bun run pre-commit

# Manage deps (in specific workspace)
bun add <package-name> --filter @teak/web
bun add --dev <package-name> --filter @teak/convex
```

```
teak/
├── apps/
│   ├── web/         # Next.js frontend (app router, shadcn/ui)
│   ├── api/         # Public API gateway (Hono)
│   ├── mobile/      # Expo RN mobile app
│   ├── desktop/     # Tauri v2 desktop app (Rust + React)
│   ├── extension/   # Chrome extension (Wxt)
│   ├── raycast/     # Raycast extension
│   └── docs/        # Documentation site (Fumadocs)
├── packages/
│   ├── convex/      # Convex backend (functions, workflows, schema, shared utils)
│   └── ui/          # Shared UI package
├── turbo.json       # Turborepo pipeline config
└── package.json     # Root package + workspaces
```

## Client-Server Patterns

- **Queries**: Real-time cached data via `convex-helpers/react/cache` `useQuery`, wrapped by `ConvexQueryCacheProvider`.
- **Mutations**: Server actions through `useMutation` / `useAction` from `@teak/convex`.
- **App wrapping**: `ConvexClientProvider` + `ConvexQueryCacheProvider` wrap trees (web, mobile, extension) to share auth + cached queries; real-time updates propagate automatically.
- **Imports**: `import { api } from "@teak/convex"`, `import { Doc } from "@teak/convex/_generated/dataModel"`, `import { CARD_TYPES } from "@teak/convex/shared/constants"`.
- **Card Types**: text, link, image, video, audio, document, palette, quote.

## AI Processing Pipeline

- Orchestrated in `packages/convex/workflows/cardProcessing.ts` using `@convex-dev/workflow` with per-step retries.
- Sequence: classification (detect type + palette colors) → categorization (links; waits for metadata) → metadata (AI tags, summary, transcript) → renderables (media thumbnails; skips tiny originals; writes via internal mutations).
- Helpers: `packages/convex/workflows/functionRefs.ts` + `packages/convex/ai`.
- Link metadata: `packages/convex/workflows/linkMetadata.ts` via `startLinkMetadataWorkflow`;

## App Surfaces

- **Web (apps/web/)**: `src/app/(auth)/`, `src/app/(settings)/admin`, `src/globals.css`, `src/layout.tsx`, `src/page.tsx`; components include `ConvexClientProvider`, card previews, `DragOverlay`, `CardModal`, `AddCardForm`, `MasonryGrid`, `SearchBar`, patterns, shadcn/ui; hooks (`useCardActions`, `useCardModal`, `useGlobalDragDrop`); config (`next.config.ts`, `eslint.config.mjs`, `components.json`).
- **Mobile (apps/mobile/)**: `app/(auth)/`, `app/(tabs)/index.tsx|add.tsx|settings.tsx`, `_layout.tsx`; components (Expo UI, `CardItem`, `CardsGrid`); `lib/hooks`; `package.json`.
- **Desktop (apps/desktop/)**: Tauri v2 app with React frontend; `src/` for React components; `src-tauri/` for Rust backend (commands, permissions, capabilities); `vite.config.ts`, `tauri.conf.json`.
- **Extension (apps/extension/)**: `src/background.ts`, `content.tsx`, `popup.tsx`; hooks (`useAutoSaveLink`, `useContextMenuSave`, `useContextMenuState`); types `contextMenu.ts`; `style.css`; assets `icon.png`; `package.json`; `tsconfig.json`.
- **Raycast (apps/raycast/)**: Raycast extension with commands (`quick-save`, `search-cards`, `favorites`), API client helpers, and extension metadata/changelog.
- **API (apps/api/)**: Hono-based API gateway for public endpoints and health/version routes; source in `src/index.ts` and runtime entrypoint `src/server.ts`.
- **Backend (packages/convex/)**: directories `_generated/`, `workflows/`, `ai/`, `card/`, `billing.ts`, `admin.ts`, `schema.ts`, `cards.ts`, `auth.config.ts`, `crons.ts`, `convex.config.ts`, entrypoint `index.ts`; shared utils/constants/hooks under `shared/`.
- **UI (packages/ui/)**: shared UI components, settings modules, and reusable hooks/constants consumed by app surfaces.
- **Docs (apps/docs/)**: `app/(home)/`, `app/docs/[[...slug]]/` + `layout.tsx`, API routes under `app/api/`, root `layout.tsx`, `global.css`; components; `content/docs/`; `lib/`; `source.config.ts`; `package.json`.
- **Repo**: Turborepo monorepo with workspaces in `apps/*` and `packages/*`; TypeScript paths point to `@teak/convex` aliases; turbo runs tasks with `--filter` for individual apps.
- **Convex**: hot deployment on save; schema changes need migrations; define indexes in `schema.ts`; scheduled functions in `crons.ts`; config in `packages/convex/convex.config.ts`; workflows must keep `processingStatus` consistent; Polar integration depends on `components.polar` + env keys `POLAR_ACCESS_TOKEN`, `POLAR_SERVER`;

## Docs Synchronization Rules

- Any API contract change in `apps/api` or `packages/convex/http.ts` must update `apps/docs/content/docs/api.mdx` in the same PR.
- Any Raycast command/auth change in `apps/raycast` must update `apps/docs/content/docs/raycast.mdx` in the same PR.

## Release Notes Hygiene

- Any user-visible feature change across web, mobile, desktop, extension, Raycast, API, or backend behavior must include a docs changelog update in `apps/docs/content/changelog/*.mdx`.
- When adding a feature, write or update tests and make sure `bun run test` passes.
- Add/extend tests for new features or bug fixes.
- Update or add fixtures/test data so tests are deterministic.
- Keep tests fast; avoid extra network calls unless the feature requires it.
