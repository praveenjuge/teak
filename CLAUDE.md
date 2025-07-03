# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Teak** is a modern full-stack monorepo built with Bun runtime, featuring:
- **Backend**: Hono.js API server with PostgreSQL and Drizzle ORM
- **Web Frontend**: React 19 + Vite with TanStack Router
- **Mobile App**: React Native with Expo
- **Authentication**: Better Auth across all platforms
- **Database**: PostgreSQL 17 with complete user management schema
- **Development**: Docker-based development environment

## Essential Commands

### Development
```bash
# Start full development environment (Docker + all services)
bun run dev

# Start individual services
bun run dev:frontend    # Web app only
bun run dev:backend     # Backend API only

# Install dependencies across all apps
bun run install:all
```

### Database Management
```bash
# Generate database migrations
bun run db:generate

# Apply migrations
bun run db:migrate

# Push schema changes directly
bun run db:push

# Open Drizzle Studio (database GUI)
bun run db:studio

# Database utilities
bun run db:connect      # Connect to database
bun run db:status       # Check database status
bun run db:reset        # Reset database
```

### Build & Production
```bash
# Build all applications
bun run build

# Individual builds
bun run build:frontend
bun run build:backend

# Production Docker
bun run docker:prod
```

### Code Quality
```bash
# Frontend linting (from apps/web/)
cd apps/web && bun run lint

# Backend type checking
bun run type-check
```

## Architecture

### Project Structure
```
teak/
├── apps/
│   ├── web/          # React 19 + Vite frontend
│   └── mobile/       # React Native + Expo app
├── backend/          # Hono.js API server
├── docker/           # Docker configurations
└── scripts/          # Development utilities
```

### Key Technologies
- **Runtime**: Bun (JavaScript runtime)
- **Backend**: Hono.js with Better Auth
- **Frontend**: React 19, TanStack Router, Tailwind CSS 4.x
- **Mobile**: React Native, Expo Router
- **Database**: PostgreSQL 17 with Drizzle ORM
- **Styling**: Tailwind CSS with Radix UI components
- **Validation**: Zod schemas with React Hook Form

### Authentication System
Better Auth is integrated across all platforms:
- **Database**: Users, sessions, accounts, verification tables
- **Backend**: `/backend/src/auth.ts` - Auth configuration
- **Web**: Better Auth React client with session management
- **Mobile**: Better Auth Expo plugin with secure storage

### Database Schema
Located in `/backend/src/db/schema.ts`:
- **Users**: Core user management
- **Sessions**: Authentication sessions
- **Accounts**: OAuth provider support
- **Verifications**: Email verification and password reset

## Development Workflow

1. **Start Development**: `bun run dev` starts Docker containers, initializes database, and opens VS Code
2. **Database Changes**: Use `bun run db:generate` → `bun run db:migrate` workflow
3. **Testing**: No test framework configured - verify manually through browser
4. **Code Quality**: Run `bun run lint` from web frontend directory

## Important File Locations

### Backend (`/backend/src/`)
- `index.ts` - Main Hono.js server with API routes
- `auth.ts` - Better Auth configuration
- `db/schema.ts` - Database schema definitions
- `db/index.ts` - Database connection and Drizzle setup
- `routes/users.ts` - User management API routes

### Web Frontend (`/apps/web/src/`)
- `main.tsx` - React 19 entry point with TanStack Router
- `App.tsx` - Main app component with authentication
- `routes/` - File-based routing with TanStack Router
- `components/` - Reusable UI components with Radix UI

### Mobile App (`/apps/mobile/`)
- `app/_layout.tsx` - Expo Router configuration with auth
- `app/` - File-based routing structure

## Environment Configuration

### Development
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- Database: `localhost:5432` (PostgreSQL)

### Environment Variables
- Development values are in Docker compose files
- Production requires `POSTGRES_PASSWORD` and `DATABASE_URL`
- Copy `.env.example` to `.env` for local customization

## Notes for Development

- **Docker Required**: Development environment runs in Docker containers
- **Hot Reload**: Enabled for both frontend and backend
- **Database Persistence**: PostgreSQL data persists between container restarts
- **Auto-Setup**: `bun run dev` handles full environment initialization
- **VS Code Integration**: Automatically opens VS Code in project directory