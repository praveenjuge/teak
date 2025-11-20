Teak ia a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

## Development Commands

```bash
# Install dependencies
bun install

# Start development (runs both frontend and backend in parallel)
bun run dev

# Start frontend only (Next.js with Turbopack)
bun run dev:frontend

# Start Convex backend only
bun run dev:backend

# Start mobile app (Expo)
bun run dev:mobile

# Start browser extension (wxt)
bun run dev:extension

# Start documentation site (Fumadocs)
bun run dev:docs

# Build browser extension
bun run build:extension

# Package browser extension for distribution
bun run package:extension

# Initialize Convex dev environment and open dashboard
bun run predev

# Build production
bun run build

# Start production server
bun run start

# Run linting
bun run lint

# Add new dependencies
bun add <package-name>

# Add dev dependencies
bun add --dev <package-name>

# Remove dependencies
bun remove <package-name>
```

## Architecture Overview

Built with a modern monorepo architecture:

### Core Stack

- **Web Frontend**: Next.js 15 with App Router, TypeScript, TailwindCSS
- **Mobile App**: Expo with React Native, TypeScript, Better Auth
- **Browser Extension**: Wxt framework with Chrome APIs, TypeScript, TailwindCSS
- **Documentation**: Fumadocs with Next.js 15, MDX content, TypeScript
- **Backend**: Convex (real-time database with serverless functions)
- **Authentication**: Better Auth with Convex integration across web, mobile, and extension
- **UI Components**: shadcn/ui with Radix primitives (web), Expo components (mobile)
- **File Storage**: Convex Storage for user uploads
- **Billing**: Polar checkout + customer portal embedded via Convex actions

### Monorepo Structure

```
teak-convex-nextjs/
├── apps/
│   ├── web/              # Next.js frontend app
│   ├── mobile/           # Expo React Native mobile app
│   ├── extension/        # Chrome browser extension (Wxt)
│   └── docs/             # Documentation site (Fumadocs)
├── backend/
│   ├── convex/           # Convex functions and database
│   │   ├── workflows/    # AI card processing pipeline orchestration (classification → renderables)
│   │   ├── tasks/        # Task helpers, AI utilities, processing status helpers
│   │   ├── billing.ts    # Polar checkout/customer portal integrations
│   │   ├── admin.ts      # Admin analytics + pipeline dashboards
│   ├── shared/           # Shared utilities, constants, types
│   └── index.ts          # Re-export surface for consumers
└── package.json          # Root workspace configuration
```

### Key Architecture Patterns

#### Client-Server Communication

- **Queries**: Cached real-time data via `convex-helpers/react/cache` `useQuery`, wrapped by `ConvexQueryCacheProvider`
- **Mutations**: Server actions with `useMutation` / `useAction` from `@teak/convex`
- **Authentication**: Better Auth sessions passed automatically to Convex functions through `@convex-dev/better-auth`
- **File Uploads**: Two-step process - generate upload URL, then upload file

#### Data Flow

1. Frontend (Next.js web, Expo mobile, Wxt Browser extension, Fumadocs docs) renders UI components
2. ConvexClientProvider + ConvexQueryCacheProvider wrap the tree with Better Auth and cached queries (web, mobile, extension)
3. Convex functions handle all server-side logic with automatic auth context
4. Real-time updates propagate automatically to connected clients

#### Import Structure

- **Convex API**: `import { api } from "@teak/convex"`
- **Convex Types**: `import { Doc } from "@teak/convex/_generated/dataModel"`
- **Shared Constants**: `import { CARD_TYPES } from "@teak/convex/shared/constants"`

## Card Management Domain

The application centers around a flexible card system:

### Card Types

- `text`: Plain text content
- `link`: URLs with metadata extraction
- `image`: Image files with dimensions
- `video`: Video files with duration
- `audio`: Audio recordings
- `document`: File attachments
- `palette`: Saved color palettes extracted from text snippets
- `quote`: Highlighted quote cards with attribution

### Card Schema (backend/convex/schema.ts)

- User-scoped with `userId` field
- Soft deletion with `isDeleted` and `deletedAt`
- Rich metadata support for different content types
- File associations via `fileId` and `thumbnailId`
- Tagging and favoriting support
- Link cards store `metadata.linkCategory` with normalized category, provider details, and confidence
- AI pipeline progress tracked via `processingStatus` stages (`classify`, `categorize`, `metadata`, `renderables`)

### Key Operations

- **Soft Delete**: Cards are marked as deleted, not removed (30-day cleanup)
- **File Management**: Automatic cleanup of associated storage files
- **Search & Filtering**: Real-time filtering by type, favorites, and tags
- **Batch Operations**: Restore, permanent delete, toggle favorites

### Link Categorization

- Normalized category constants live in `backend/shared/linkCategories.ts` and power schema validators
- Workflow categorization step enriches link cards with provider metadata and confidence scores
- Admin dashboards surface category coverage through pipeline summaries

## AI Processing Pipeline

- Orchestrated by `backend/convex/workflows/cardProcessing.ts` using `@convex-dev/workflow` with retries per step
- Steps run in sequence: **classification** (detect type + palette colors) → **categorization** (links only, waits for metadata) → **metadata** (AI tags, summary, transcript) → **renderables** (thumbnail generation for media)
- Workflow helpers live in `backend/convex/workflows/functionRefs.ts` and reuse task utilities in `backend/convex/tasks/ai`
- Each stage updates `processingStatus` and logs with `[workflow/*]` prefixes surfaced in admin dashboards
- `workflows/steps/renderables` handles thumbnail generation, skipping tiny originals and writing results through internal mutations
- Link metadata extraction is handled by `backend/convex/workflows/linkMetadata.ts`, kicked off via `startLinkMetadataWorkflow`; retries for Cloudflare scrape/HTTP failures now live inside the workflow instead of ad-hoc scheduler loops.

## Billing & Subscription

- Polar checkout embeds live in `apps/web/app/subscription/page.tsx` via `@polar-sh/checkout/embed`
- Environment-aware plan IDs (production vs sandbox) determine the product passed to `createCheckoutLink`
- `api.billing.createCheckoutLink`/`createCustomerPortal` actions in `backend/convex/billing.ts` coordinate with Polar SDK and Convex `components.polar`
- `userHasPremium` query caches membership status and pairs with `FREE_TIER_LIMIT` to show usage caps
- Subscription UI includes usage badge, feature list, and customer portal launcher—keep messaging aligned with `featureList`

## Project Structure

### Web Frontend (apps/web/)

```
apps/web/
├── app/
│   ├── (auth)/           # Authentication routes (Better Auth email/password)
│   ├── admin/page.tsx    # Admin insights dashboard with pipeline summaries
│   ├── subscription/page.tsx # Polar checkout + customer portal entry
│   ├── globals.css       # Global styles with custom CSS variables
│   ├── layout.tsx        # Root layout with Better Auth + Convex providers
│   └── page.tsx          # Main dashboard using cached Convex queries
├── components/
│   ├── AlphaBanner.tsx   # Dismissible alpha-state banner
│   ├── ConvexClientProvider.tsx # Convex + Better Auth provider wrapper
│   ├── card-previews/    # Preview UIs for each card type
│   ├── DragOverlay.tsx   # Drag-and-drop overlay styling
│   ├── CardModal.tsx     # Card editing/viewing modal
│   ├── AddCardForm.tsx   # Card creation form
│   ├── MasonryGrid.tsx   # Card display grid
│   ├── SearchBar.tsx     # Search input with tag/type filters
│   ├── patterns/         # Background pattern components
│   └── ui/               # shadcn/ui components
├── hooks/                # Custom React hooks (useCardActions, useCardModal, useGlobalDragDrop)
└── package.json          # Web app dependencies
```

### Mobile App (apps/mobile/)

```
apps/mobile/
├── app/
│   ├── (auth)/           # Authentication screens
│   ├── (tabs)/           # Tab navigation screens
│   │   ├── index.tsx     # Home screen with cards grid
│   │   ├── add.tsx       # Add card screen
│   │   └── settings.tsx  # Settings screen
│   └── _layout.tsx       # Root navigation layout
├── components/
│   ├── ui/               # Expo-specific UI components
│   ├── CardItem.tsx      # Individual card component
│   ├── CardsGrid.tsx     # Cards grid layout
│   └── SearchInput.tsx   # Search functionality
├── lib/hooks/            # Mobile-specific hooks
└── package.json          # Mobile app dependencies
```

### Browser Extension (apps/extension/)

```
apps/extension/
├── src/
│   ├── background.ts     # Background script for context menus and events
│   ├── content.tsx       # Content script for page interaction
│   ├── popup.tsx         # Extension popup UI with authentication
│   ├── hooks/            # Extension-specific hooks
│   │   ├── useAutoSaveLink.ts    # Auto-save active tab functionality
│   │   ├── useContextMenuSave.ts # Context menu save operations
│   │   └── useContextMenuState.ts # Context menu state management
│   ├── types/
│   │   └── contextMenu.ts # Context menu type definitions
│   └── style.css         # TailwindCSS styles
├── assets/
│   └── icon.png          # Extension icon
├── package.json          # Extension dependencies
└── tsconfig.json         # TypeScript configuration
```

### Backend (backend/)

```
backend/
├── convex/
│   ├── _generated/   # Auto-generated Convex types
│   ├── workflows/    # Card processing workflow + step actions (classification, categorization, metadata, renderables)
│   ├── tasks/        # AI helpers, metadata generators, processing status utilities
│   ├── billing.ts    # Polar checkout & customer portal integrations
│   ├── admin.ts      # Admin queries/actions for pipeline analytics
│   ├── schema.ts     # Database schema definitions
│   ├── cards.ts      # Card CRUD operations
│   ├── auth.config.ts # Better Auth domain configuration for Convex
│   ├── crons.ts      # Scheduled cleanup jobs
│   └── convex.config.ts # Convex configuration
├── shared/           # Shared utilities consumed by clients (constants, linkCategories, hooks, utils)
├── index.ts          # Package entry point re-exporting backend surface
├── .env.local        # Backend environment variables
└── package.json      # Backend package config
```

### Documentation Site (apps/docs/)

```
apps/docs/
├── app/
│   ├── (home)/           # Homepage layout and content
│   ├── docs/             # Documentation pages
│   │   ├── [[...slug]]/  # Dynamic documentation routing
│   │   └── layout.tsx    # Documentation layout
│   ├── api/              # API routes for search
│   ├── layout.tsx        # Root application layout
│   └── global.css        # Global styles
├── components/           # Documentation UI components
├── content/              # MDX documentation content
│   └── docs/             # Organized documentation files
├── lib/                  # Documentation utilities
├── source.config.ts      # Fumadocs source configuration
└── package.json          # Documentation dependencies
```

### Shared Code (backend/shared/)

```
backend/shared/
├── constants.ts             # Shared constants and derived helpers
├── index.ts                 # Entry point re-exporting shared pieces
├── linkCategories.ts        # Link categorization constants and types
├── hooks/
│   ├── useCardActions.ts    # Shared card action helper factory
│   └── useFileUpload.ts     # Shared file upload hook core
└── utils/
    └── colorUtils.ts        # Color parsing helpers
```

## Authentication Flow

### Web Authentication

1. Better Auth email/password flows live under `/login`, `/register`, `/forgot-password`, and `/reset-password`.
2. `ConvexBetterAuthProvider` shares the session with Convex via `@convex-dev/better-auth`.
3. Middleware and server actions rely on `ctx.auth` from Better Auth.

### Mobile Authentication

1. Better Auth client (`better-auth/react` + `@better-auth/expo/client`) manages the session with SecureStore persistence.
2. `ConvexBetterAuthProvider` wraps the Expo app so Convex calls carry the auth token.

### Extension Authentication

1. The popup bootstraps Better Auth through `createAuthClient` and the cross-domain plugin.
2. `ConvexBetterAuthProvider` shares the session with Convex React client for background/content interactions.

## File Upload Pattern

1. Generate upload URL: `generateUploadUrl()` mutation
2. Upload file directly to Convex Storage
3. Create card record with `fileId` reference
4. Access files via `getFileUrl()` query with security checks

## Search & Filtering System

Implemented in `useSearchFilters` hook:

- **Real-time search** across card content and metadata
- **Tag-based filtering** with keyword extraction
- **Type filtering** by card type
- **State filters** (favorites, trash)
- **Typeahead suggestions** for quick navigation

## Development Notes

### Monorepo Specifics

- **Workspaces**: npm workspaces manage dependencies across packages
- **TypeScript**: Project references for efficient compilation
- **Imports**: Use `@teak/convex` (including the `@teak/convex/shared` subpath) workspace packages
- **Scripts**: Run from root with workspace targeting

### Convex Specifics

- Functions are deployed automatically on save during development
- Schema changes require database migrations
- Use indexes for efficient queries (defined in schema.ts)
- Scheduled functions run via crons.ts
- Config located at `backend/convex/convex.config.ts`
- Workflow orchestration uses `@convex-dev/workflow`; definitions live in `backend/convex/workflows` and must update `processingStatus` consistently
- Polar integration depends on `components.polar` and env keys (`POLAR_ACCESS_TOKEN`, `POLAR_SERVER`)—keep them wired in `backend/convex/billing.ts`
- **Registration gate**: `ENABLE_MULTIPLE_USER_REGISTRATION` defaults to `false`/unset, so only the very first account can register and later attempts receive "Registration is currently closed" while existing users continue to sign in. Set it to `true` for local/dev work (`backend/convex/.env.local`) and sync the Convex secret with:

```bash
cd backend && npx convex env set ENABLE_MULTIPLE_USER_REGISTRATION true
```

### Component Patterns

- Heavy use of compound components (CardModal, SearchBar)
- Custom hooks for business logic (useCardActions, useSearchFilters, useAutoSaveLink)
- Always use shadcn/ui components for consistent design system (web)
- Masonry grid layout for card display
- Card preview components for different content types (text, link, image, video, audio, document)
- Root layout composes ThemeProvider, ConvexClientProvider (Better Auth + Convex), ConvexQueryCacheProvider, and Sonner toasts
- Convex handles all server state automatically
- Real-time updates without additional setup, with caching provided by `ConvexQueryCacheProvider` + `convex-helpers` hooks

### Deployment & Security

- `apps/web/next.config.ts` and `apps/docs/next.config.mjs` inject strict security headers (HSTS, X-Frame-Options, etc.)—retain them when modifying Next config
