Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

## Quick Commands

```bash
# Install dependencies
bun install

# Dev (frontend + backend)
bun run dev

# Frontend only (Next.js + Turbopack)
bun run dev:frontend

# Convex backend only
bun run dev:backend

# Mobile app (Expo)
bun run dev:mobile

# Browser extension (wxt)
bun run dev:extension

# Documentation site (Fumadocs)
bun run dev:docs

# Build/package browser extension
bun run build:extension
bun run package:extension

# Init Convex dev env + open dashboard
bun run predev

# Production build / start
bun run build
bun run start

# Lint
bun run lint

# Manage deps
bun add <package-name>
bun add --dev <package-name>
bun remove <package-name>
```

## Architecture at a Glance

- **Core stack**: Next.js (App Router, TS, Tailwind), Expo RN, Wxt + Chrome APIs, Fumadocs (Next.js + MDX), Convex backend, Better Auth, shadcn/ui (web) & Expo UI, Convex Storage, Polar billing.
- **Monorepo structure**

```
teak-convex-nextjs/
├── web/          # Next.js frontend
├── mobile/       # Expo RN mobile app
├── extension/    # Chrome extension (Wxt)
├── docs/         # Documentation site (Fumadocs)
├── backend/
│   ├── convex/       # Convex functions & workflows
│   ├── shared/       # Shared utils/constants/types
│   └── index.ts      # Re-export surface
└── package.json      # Root workspace config
```

## Client-Server Patterns

- **Queries**: Real-time cached data via `convex-helpers/react/cache` `useQuery`, wrapped by `ConvexQueryCacheProvider`.
- **Mutations**: Server actions through `useMutation` / `useAction` from `@teak/convex`.
- **Auth context**: Better Auth sessions flow automatically to Convex with `@convex-dev/better-auth`.
- **App wrapping**: `ConvexClientProvider` + `ConvexQueryCacheProvider` wrap trees (web, mobile, extension) to share auth + cached queries; real-time updates propagate automatically.
- **Data flow**: 1) UI renders cards (web, mobile, extension, docs) → 2) providers wrap tree → 3) Convex functions handle server logic with `ctx.auth` → 4) live updates pushed to clients.
- **Imports**: `import { api } from "@teak/convex"`, `import { Doc } from "@teak/convex/_generated/dataModel"`, `import { CARD_TYPES } from "@teak/convex/shared/constants"`.
- **File uploads**: two-step (generate upload URL → upload file) — full flow in “File Upload Pattern.”

## Product Domain — Cards

- **Types**: text, link, image, video, audio, document, palette, quote.
- **Schema highlights (backend/convex/schema.ts)**: user-scoped `userId`; soft delete via `isDeleted`/`deletedAt`; rich type metadata; file links via `fileId`/`thumbnailId`; tagging + favorites; link metadata with normalized category/provider/confidence; `processingStatus` stages (`classify`, `categorize`, `metadata`, `renderables`).
- **Operations**: soft delete (30-day cleanup), automatic storage cleanup, real-time search/filtering (type, favorites, tags), batch restore/perma-delete/toggle favorites.

## AI Processing Pipeline

- Orchestrated in `backend/convex/workflows/cardProcessing.ts` using `@convex-dev/workflow` with per-step retries.
- Sequence: classification (detect type + palette colors) → categorization (links; waits for metadata) → metadata (AI tags, summary, transcript) → renderables (media thumbnails; skips tiny originals; writes via internal mutations).
- Helpers: `backend/convex/workflows/functionRefs.ts` + `backend/convex/tasks/ai`.
- Logging: updates `processingStatus` and logs with `[workflow/*]` prefixes for admin dashboards.
- Link metadata: `backend/convex/workflows/linkMetadata.ts` via `startLinkMetadataWorkflow`; Cloudflare scrape/HTTP retries handled inside the workflow.

## Authentication

- **Web**: Email/password routes at `/login`, `/register`, `/forgot-password`, `/reset-password`; `ConvexBetterAuthProvider` shares session to Convex via `@convex-dev/better-auth`; middleware/server actions rely on `ctx.auth`.
- **Mobile**: `better-auth/react` + `@better-auth/expo/client` with SecureStore; `ConvexBetterAuthProvider` wraps the app so Convex calls carry the auth token.
- **Extension**: Popup bootstraps Better Auth with `createAuthClient` + cross-domain plugin; `ConvexBetterAuthProvider` shares session for background/content interactions.

## App Surfaces

- Search & Filtering implemented in `useSearchFilters` hook: real-time search across content/metadata, tag keyword extraction, type filtering, favorites/trash state filters, typeahead suggestions.
- **Web (web/)**: `app/(auth)/`, `admin/page.tsx` (pipeline summaries), `globals.css`, `layout.tsx`, `page.tsx`; components include `ConvexClientProvider`, card previews, `DragOverlay`, `CardModal`, `AddCardForm`, `MasonryGrid`, `SearchBar`, patterns, shadcn/ui; hooks (`useCardActions`, `useCardModal`, `useGlobalDragDrop`); `package.json`.
- **Mobile (mobile/)**: `app/(auth)/`, `app/(tabs)/index.tsx|add.tsx|settings.tsx`, `_layout.tsx`; components (Expo UI, `CardItem`, `CardsGrid`, `SearchInput`); `lib/hooks`; `package.json`.
- **Extension (extension/)**: `src/background.ts`, `content.tsx`, `popup.tsx`; hooks (`useAutoSaveLink`, `useContextMenuSave`, `useContextMenuState`); types `contextMenu.ts`; `style.css`; assets `icon.png`; `package.json`; `tsconfig.json`.
- **Backend (backend/)**: Convex directories `_generated/`, `workflows/`, `tasks/`, `billing.ts`, `admin.ts`, `schema.ts`, `cards.ts`, `auth.config.ts`, `crons.ts`, `convex.config.ts`; shared utils/constants/hooks under `shared/`; `index.ts`; `.env.local`; `package.json`.
- **Docs (docs/)**: `app/(home)/`, `app/docs/[[...slug]]/` + `layout.tsx`, API routes under `app/api/`, root `layout.tsx`, `global.css`; components; `content/docs/`; `lib/`; `source.config.ts`; `package.json`.
- **Shared code (backend/shared/)**: `constants.ts`, `index.ts`, `linkCategories.ts`, hooks (`useCardActions.ts`, `useFileUpload.ts`), utils (`colorUtils.ts`).
- **Monorepo**: npm workspaces; TypeScript project references; imports via `@teak/convex` and `@teak/convex/shared`; run scripts from root with workspace targeting.
- **Convex**: hot deployment on save; schema changes need migrations; define indexes in `schema.ts`; scheduled functions in `crons.ts`; config in `backend/convex/convex.config.ts`; workflows must keep `processingStatus` consistent; Polar integration depends on `components.polar` + env keys `POLAR_ACCESS_TOKEN`, `POLAR_SERVER`;
- **Component patterns**: compound components (CardModal, SearchBar), business-logic hooks (`useCardActions`, `useSearchFilters`, `useAutoSaveLink`), shadcn/ui on web, masonry grid for cards, card preview components per type (text/link/image/video/audio/document), root layout composes ThemeProvider + ConvexClientProvider (Better Auth + Convex) + ConvexQueryCacheProvider + Sonner toasts, Convex handles server state + real-time updates via `ConvexQueryCacheProvider` + `convex-helpers` hooks.
- Actions `api.billing.createCheckoutLink` / `createCustomerPortal` in `backend/convex/billing.ts` coordinate Polar SDK + Convex `components.polar`.
- `userHasPremium` query caches membership; pairs with `FREE_TIER_LIMIT` for caps; UI shows usage badge, feature list, and customer portal launcher—keep messaging aligned with `featureList`.
