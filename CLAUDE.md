# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Development Commands

```bash
# Start development (runs both frontend and backend in parallel)
npm run dev

# Start frontend only (Next.js with Turbopack)
npm run dev:frontend

# Start Convex backend only
npm run dev:backend

# Initialize Convex dev environment and open dashboard
npm run predev

# Build production
npm run build

# Start production server
npm run start

# Run linting
npm run lint
```

## Architecture Overview

Teak is a card management application built with a modern full-stack
architecture:

### Core Stack

- **Frontend**: Next.js 15 with App Router, TypeScript, TailwindCSS
- **Backend**: Convex (real-time database with serverless functions)
- **Authentication**: Clerk with JWT integration
- **UI Components**: shadcn/ui with Radix primitives
- **File Storage**: Convex Storage for user uploads

### Key Architecture Patterns

#### Client-Server Communication

- **Queries**: Real-time data fetching with `useQuery(api.cards.getCards, args)`
- **Mutations**: Server actions with `useMutation(api.cards.createCard)`
- **Authentication**: Clerk JWT tokens passed automatically to Convex functions
- **File Uploads**: Two-step process - generate upload URL, then upload file

#### Data Flow

1. Next.js frontend renders UI components
2. ConvexClientProvider wraps app with Clerk authentication
3. Convex functions handle all server-side logic with automatic auth context
4. Real-time updates propagate automatically to connected clients

## Card Management Domain

The application centers around a flexible card system:

### Card Types

- `text`: Plain text content
- `link`: URLs with metadata extraction
- `image`: Image files with dimensions
- `video`: Video files with duration
- `audio`: Audio recordings
- `document`: File attachments

### Card Schema (convex/schema.ts)

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

### Frontend (Next.js App Router)

```
app/
├── (auth)/           # Authentication routes
├── globals.css       # Global styles with custom CSS variables
├── layout.tsx        # Root layout with providers
└── page.tsx          # Main dashboard page

components/
├── ui/               # shadcn/ui components
├── patterns/         # Background pattern components  
├── Dashboard.tsx     # Main dashboard orchestrator
├── CardModal.tsx     # Card editing/viewing modal
├── MasonryGrid.tsx   # Card display grid
└── AddCardForm.tsx   # Card creation form
```

### Backend (Convex)

```
convex/
├── _generated/       # Auto-generated Convex types
├── schema.ts         # Database schema definitions
├── cards.ts          # Card CRUD operations
├── auth.config.ts    # Clerk authentication config
└── crons.ts          # Scheduled cleanup jobs
```

## Authentication Flow

1. Clerk handles user registration/login at `/login` and `/register`
2. JWT tokens are automatically passed to Convex functions
3. Middleware protects all routes except auth pages
4. Convex functions access user context via `ctx.auth.getUserIdentity()`

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

### Convex Specifics

- Functions are deployed automatically on save during development
- Schema changes require database migrations
- Use indexes for efficient queries (defined in schema.ts)
- Scheduled functions run via crons.ts

### Component Patterns

- Heavy use of compound components (CardModal, SearchBar)
- Custom hooks for business logic (useCardActions, useSearchFilters)
- Always use shadcn/ui components for consistent design system
- Masonry grid layout for card display

### State Management

- Convex handles all server state automatically
- Local UI state managed with React hooks
- Real-time updates without additional setup
