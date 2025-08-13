# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

Teak ia a streamlined personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

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
- **Mobile App**: Expo with React Native, TypeScript, Clerk authentication
- **Backend**: Convex (real-time database with serverless functions)
- **Authentication**: Clerk with JWT integration (web + mobile)
- **UI Components**: shadcn/ui with Radix primitives (web), Expo components (mobile)
- **File Storage**: Convex Storage for user uploads

### Monorepo Structure

```
teak-convex-nextjs/
├── apps/
│   ├── web/              # Next.js frontend app
│   └── mobile/           # Expo React Native mobile app
├── packages/
│   ├── shared/           # Shared utilities, constants, types
│   └── backend/          # Backend services and configuration
│       └── convex/       # Convex functions and database
└── package.json          # Root workspace configuration
```

### Key Architecture Patterns

#### Client-Server Communication

- **Queries**: Real-time data fetching with `useQuery(api.cards.getCards, args)`
- **Mutations**: Server actions with `useMutation(api.cards.createCard)`
- **Authentication**: Clerk JWT tokens passed automatically to Convex functions
- **File Uploads**: Two-step process - generate upload URL, then upload file

#### Data Flow

1. Frontend (Next.js web or Expo mobile) renders UI components
2. ConvexClientProvider wraps app with Clerk authentication
3. Convex functions handle all server-side logic with automatic auth context
4. Real-time updates propagate automatically to connected clients

#### Import Structure

- **Convex API**: `import { api } from "@teak/convex"`
- **Convex Types**: `import { Doc } from "@teak/convex/_generated/dataModel"`
- **Shared Constants**: `import { CARD_TYPES } from "@teak/shared/constants"`

## Card Management Domain

The application centers around a flexible card system:

### Card Types

- `text`: Plain text content
- `link`: URLs with metadata extraction
- `image`: Image files with dimensions
- `video`: Video files with duration
- `audio`: Audio recordings
- `document`: File attachments

### Card Schema (packages/backend/convex/schema.ts)

- User-scoped with `userId` field
- Soft deletion with `isDeleted` and `deletedAt`
- Rich metadata support for different content types
- File associations via `fileId` and `thumbnailId`
- Tagging and favoriting support

### Key Operations

- **Soft Delete**: Cards are marked as deleted, not removed (30-day cleanup)
- **File Management**: Automatic cleanup of associated storage files
- **Search & Filtering**: Real-time filtering by type, favorites, and tags
- **Batch Operations**: Restore, permanent delete, toggle favorites

## Project Structure

### Web Frontend (apps/web/)

```
apps/web/
├── app/
│   ├── (auth)/           # Authentication routes
│   ├── globals.css       # Global styles with custom CSS variables
│   ├── layout.tsx        # Root layout with providers
│   └── page.tsx          # Main dashboard page
├── components/
│   ├── ui/               # shadcn/ui components
│   ├── patterns/         # Background pattern components
│   ├── Dashboard.tsx     # Main dashboard orchestrator
│   ├── CardModal.tsx     # Card editing/viewing modal
│   ├── MasonryGrid.tsx   # Card display grid
│   └── AddCardForm.tsx   # Card creation form
├── hooks/                # Custom React hooks
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

### Backend (packages/backend/)

```
packages/backend/
├── convex/
│   ├── _generated/   # Auto-generated Convex types
│   ├── schema.ts     # Database schema definitions
│   ├── cards.ts      # Card CRUD operations
│   ├── auth.config.ts # Clerk authentication config
│   ├── crons.ts      # Scheduled cleanup jobs
│   └── package.json  # Convex package config
├── .env.local        # Backend environment variables
└── package.json      # Backend workspace config
```

### Shared Code (packages/shared/)

```
packages/shared/
├── src/
│   ├── constants.ts  # Shared constants and types
│   ├── utils.ts      # Shared utility functions
│   └── index.ts      # Package exports
└── package.json      # Shared package config
```

## Authentication Flow

### Web Authentication

1. Clerk handles user registration/login at `/login` and `/register`
2. JWT tokens are automatically passed to Convex functions
3. Middleware protects all routes except auth pages
4. Convex functions access user context via `ctx.auth.getUserIdentity()`

### Mobile Authentication

1. Clerk Expo SDK handles authentication screens
2. SecureStore manages token persistence
3. ConvexClientProvider automatically includes auth tokens
4. Same Convex auth context as web application

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
- **Imports**: Use `@teak/convex` and `@teak/shared` workspace packages
- **Scripts**: Run from root with workspace targeting

### Convex Specifics

- Functions are deployed automatically on save during development
- Schema changes require database migrations
- Use indexes for efficient queries (defined in schema.ts)
- Scheduled functions run via crons.ts
- Config located at `packages/backend/convex/convex.config.ts`

### Component Patterns

- Heavy use of compound components (CardModal, SearchBar)
- Custom hooks for business logic (useCardActions, useSearchFilters)
- Always use shadcn/ui components for consistent design system
- Masonry grid layout for card display

### State Management

- Convex handles all server state automatically
- Real-time updates without additional setup
