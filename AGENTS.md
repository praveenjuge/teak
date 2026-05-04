Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

## Quick Commands

```bash
# Install dependencies
bun install

# Dev (web + convex backend)
bun run dev

# Dev (all services)
bun run dev:all

# Individual services
bun run dev:web        # Next.js web + Convex
bun run dev:convex     # Convex backend only
bun run dev:api        # Hono API gateway
bun run dev:mobile     # Expo mobile app
bun run dev:desktop    # Electron desktop app
bun run dev:extension  # Browser extension + Convex
bun run dev:raycast    # Raycast extension
bun run dev:docs       # Documentation site

# Build/package extensions
bun run build:extension
bun run build:raycast
bun run publish:raycast

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

# Clear caches
bun run clean

# Manage deps (in specific workspace)
bun add <package-name> --filter @teak/web
bun add --dev <package-name> --filter @teak/convex
```

```
teak/
├── apps/
│   ├── web/         # Next.js frontend (app router, shadcn/ui)
│   ├── api/         # Public API gateway (Hono + MCP)
│   ├── mobile/      # Expo RN mobile app
│   ├── desktop/     # Electron desktop app (React)
│   ├── extension/   # Chrome extension (Wxt)
│   ├── raycast/     # Raycast extension
│   └── docs/        # Documentation site (Astro + Starlight)
├── packages/
│   ├── convex/      # Convex backend (functions, workflows, schema, shared utils)
│   └── ui/          # Shared UI package (components, hooks, screens, feedback)
├── turbo.json       # Turborepo pipeline config
└── package.json     # Root package + workspaces
```

## Client-Server Patterns

- **Queries**: Real-time cached data via `convex-helpers/react/cache` `useQuery`, wrapped by `ConvexQueryCacheProvider`.
- **Mutations**: Server actions through `useMutation` / `useAction` from `@teak/convex`.
- **Auth context**: Better Auth sessions flow automatically to Convex with `@convex-dev/better-auth`.
- **App wrapping**: `ConvexClientProvider` + `ConvexQueryCacheProvider` wrap trees (web, mobile, extension) to share auth + cached queries; real-time updates propagate automatically.
- **Imports**: `import { api } from "@teak/convex"`, `import { Doc } from "@teak/convex/_generated/dataModel"`, `import { CARD_TYPES } from "@teak/convex/shared/constants"`.
- **Card Types**: text, link, image, video, audio, document, palette, quote.

## AI Processing Pipeline

- Orchestrated in `packages/convex/workflows/cardProcessing.ts` using `@convex-dev/workflow` with per-step retries.
- Sequence: classification (detect type + palette colors) → categorization (links; waits for metadata) → metadata (AI tags, summary, transcript) → renderables (media thumbnails; skips tiny originals; writes via internal mutations).
- Helpers: `packages/convex/workflows/functionRefs.ts` + `packages/convex/ai`.
- Link metadata: `packages/convex/workflows/linkMetadata.ts` via `startLinkMetadataWorkflow`;

## App Surfaces

- **Web (apps/web/)**: `src/app/(auth)/`, `src/app/(settings)/settings`, `src/globals.css`, `src/layout.tsx`, `src/page.tsx`; components include `ConvexClientProvider`, `SentryUserManager`, `JsonLd`; most UI components (card previews, grids, modals, forms, search, patterns) live in `@teak/ui`; hooks (`useGlobalDragDrop`); Sentry error tracking via `instrumentation.ts`; config (`next.config.ts`, `eslint.config.mjs`, `components.json`).
- **Mobile (apps/mobile/)**: `app/(auth)/`, `app/(tabs)/(home)/|add/|settings/`, `_layout.tsx`; components (Expo UI, `CardItem`, `CardsGrid`, `CardPreviewSheet`, `ErrorBoundary`, `Logo`); `lib/hooks`, `lib/share`, `lib/auth-client.ts`, `lib/recording.ts`; `package.json`.
- **Desktop (apps/desktop/)**: Electron app with React frontend; `src/main/` for Electron main process; `src/preload/` for context bridge; `src/` for React renderer components; `src/pages/`, `src/hooks/`, `src/components/`, `src/lib/`; `electron.vite.config.ts`, `electron-builder.config.ts`.
- **Extension (apps/extension/)**: Wxt-based Chrome extension; `entrypoints/background.ts`, `entrypoints/content.ts`, `entrypoints/content/`, `entrypoints/popup/`; hooks (`useAutoSaveUrl`, `useContextMenuSave`, `useWebAppSession`); types (`contextMenu.ts`, `messages.ts`, `social.ts`); `utils/`, `lib/`, `scripts/`; `style.css`; assets in `public/`; `wxt.config.ts`; `package.json`; `tsconfig.json`.
- **Raycast (apps/raycast/)**: Raycast extension with commands (`quick-save`, `save-clipboard-url`, `save-current-browser-tab`, `search-cards`, `favorites`), AI tools (`search-cards`, `get-card`, `save-card`), API client helpers, and extension metadata/changelog.
- **API (apps/api/)**: Hono-based API gateway with REST routes (`src/routes/rest.ts`) and MCP routes (`src/routes/mcp.ts`); uses `@hono/mcp` + `@modelcontextprotocol/sdk`; source in `src/index.ts` and runtime entrypoint `src/server.ts`.
- **Backend (packages/convex/)**: directories `_generated/`, `workflows/`, `ai/`, `card/`, `client/`, `linkMetadata/`, `migrations/`, `packages/`, `shared/`, `storage/`, `types/`; key files `billing.ts`, `admin.ts`, `schema.ts`, `cards.ts`, `auth.config.ts`, `auth.ts`, `authDesktop.ts`, `http.ts`, `apiKeys.ts`, `publicApi.ts`, `raycast.ts`, `raycastHttp.ts`, `idempotency.ts`, `crons.ts`, `convex.config.ts`, entrypoint `index.ts`; shared utils/constants/hooks under `shared/`.
- **UI (packages/ui/)**: shared UI component library consumed by web, desktop, and extension; `src/components/` (cards, card-modal, card-previews, forms, grids, modals, patterns, search, selection, settings, ui); `src/feedback/` (skeletons, loading, error states, drag overlay, empty state); `src/screens/`, `src/hooks/`, `src/icons/`, `src/constants/`; `convexQueryCache.ts`, `convexQueryHooks.ts`, `logo.tsx`, `styles.css`.
- **Docs (apps/docs/)**: Astro + Starlight static site; `src/content/docs/docs/` for documentation MDX; `src/content/changelog/` for release notes; `src/components/` for Astro components; `src/layouts/` for page layouts; `src/assets/` for fonts and logos; `src/styles/starlight.css`; `src/lib/`; `astro.config.ts`; `package.json`.
- **Repo**: Turborepo monorepo with workspaces in `apps/*` and `packages/*`; TypeScript paths point to `@teak/convex` aliases; turbo runs tasks with `--filter` for individual apps.
- **Convex**: hot deployment on save; schema changes need migrations; define indexes in `schema.ts`; scheduled functions in `crons.ts`; config in `packages/convex/convex.config.ts`; workflows must keep `processingStatus` consistent; Polar integration depends on `components.polar` + env keys `POLAR_ACCESS_TOKEN`, `POLAR_SERVER`;

## Docs Synchronization Rules

- Any API contract change in `apps/api` or `packages/convex/http.ts` must update `apps/docs/src/content/docs/docs/api.mdx` in the same PR.
- Any MCP endpoint change in `apps/api/src/routes/mcp.ts` must update `apps/docs/src/content/docs/docs/mcp.mdx` in the same PR.
- Any Raycast command/auth change in `apps/raycast` must update `apps/docs/src/content/docs/docs/raycast.mdx` in the same PR.

## Release Notes Hygiene

- Any user-visible feature change across web, mobile, desktop, extension, Raycast, API, or backend behavior must include a docs changelog update in `apps/docs/src/content/changelog/*.mdx`.
- When adding a feature, write or update tests and make sure `bun run test` passes.
- Add/extend tests for new features or bug fixes.
- Update or add fixtures/test data so tests are deterministic.
- Keep tests fast; avoid extra network calls unless the feature requires it.

## Desktop Release Process

The desktop app uses Electron with `electron-builder` and ships signed, notarized macOS builds via GitHub Releases.

To publish a new desktop release:

1. Bump the `version` field in **every** `package.json` across the monorepo (root + all workspaces under `apps/*` and `packages/*`).
2. Commit and push to `main`.
3. Create and push a version tag:
   ```bash
   git tag v<version>
   git push origin v<version>
   ```
4. The `Desktop Release` workflow (`.github/workflows/desktop-release.yml`) triggers on the `v*` tag and automatically:
   - Builds the renderer, main process, and preload via `electron-vite build` with production env vars.
   - Imports signing credentials (Developer ID certificate + App Store Connect API key) from GitHub Actions secrets.
   - Packages, code-signs, and notarizes the macOS ARM64 app via `electron-builder`.
   - Verifies codesign (`codesign --verify --deep --strict`), Gatekeeper assessment (`spctl --assess`), and stapled notarization ticket.
   - Publishes all artifacts (DMG, zip, blockmaps, `latest-mac.yml`) to a GitHub Release only after verification passes.
5. Existing installs pick up the update silently via `electron-updater` on next launch.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
