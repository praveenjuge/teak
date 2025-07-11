# Teak

Teak is a streamlined personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

- **Runtime**: Bun
- **Backend**: Hono.js API server (@teak/backend)
- **Web App**: React 19 + Vite (@teak/web)
- **Mobile App**: React Native with Expo (@teak/mobile)
- **Database**: PostgreSQL 17 with Drizzle ORM
- **Containerization**: Docker

## 📁 Project Structure

```
teak/
├── backend/                 # Backend API server
│   ├── src/
│   │   ├── index.ts         # Hono.js server entry point
│   │   ├── routes/          # API route handlers
│   │   ├── services/        # Business logic services
│   │   ├── db/              # Database schema & connection
│   │   └── auth.ts          # Better Auth configuration
├── apps/
│   ├── web/                 # React 19 frontend (@teak/web)
│   │   ├── src/
│   │   │   ├── App.tsx      # Main React app
│   │   │   ├── routes/      # TanStack Router routes
│   │   │   └── components/  # Reusable UI components
│   └── mobile/              # React Native mobile app (@teak/mobile)
│       ├── app/             # Expo Router file-based routing
├── docker/                  # Docker configurations
├── scripts/                 # Utility & bootstrap scripts
├── postman/                 # API testing collection
├── .env.example             # Environment variables template
├── package.json             # Root monorepo orchestrator (@teak/root)
└── README.md                # This file
```

## 🚀 Quick Start

### Prerequisites

- **Docker & Docker Compose** (for database and containerized development)
- **Bun 1.0+** (JavaScript runtime)

### Bootstrap Project

1. **Clone and setup the entire project:**

   ```bash
   git clone git@github.com:praveenjuge/teak.git
   cd teak
   bun run bootstrap
   ```

   This single command will:
   - Install all dependencies across workspaces
   - Setup and configure the database
   - Initialize environment files
   - Verify prerequisites

### Alternative Setup (Manual)

If you prefer step-by-step setup:

```bash
# Install all dependencies
bun run install:all

# Setup database (starts Docker containers, runs migrations, seeds data)
bun run setup:db

# Copy environment file
cp .env.example .env
```

## 🛠️ Development Commands

### Core Commands

```bash
# Start full development environment (Docker + all services)
bun run dev

# Start individual services
bun run dev:backend    # Backend API server only
bun run dev:frontend   # React web app only
bun run dev:mobile     # React Native mobile app

# Build all applications
bun run build

# Build individual apps
bun run build:backend
bun run build:frontend
```

### Database Management

```bash
# Backend database commands (run from backend/ directory)
cd backend

bun run db:generate    # Generate database migrations
bun run db:migrate     # Apply migrations to database
bun run db:push        # Push schema changes directly
bun run db:studio      # Open Drizzle Studio (database GUI)
bun run db:seed        # Seed database with sample data

# Root level database utilities
bun run db:connect     # Connect to database via psql
bun run db:status      # Check database connection status
bun run db:reset       # Reset database (destructive!)
```

### Docker Commands

```bash
# Development environment
bun run docker:dev         # Start development containers
bun run docker:dev:down    # Stop development containers
bun run docker:dev:clean   # Stop and remove all containers + volumes

# Production environment
bun run docker:prod        # Start production containers
```

### Services Information

- **Frontend**: http://localhost:3000 (React 19 + Vite)
- **Backend API**: http://localhost:3001 (Hono.js)
- **Database**: localhost:5432 (PostgreSQL 17)
- **Drizzle Studio**: http://localhost:4983 (when running `db:studio`)

## 🗄️ Database

### PostgreSQL Setup

The project uses PostgreSQL 17 as the database, which is automatically
configured and started through Docker Compose.

#### Development Database

- **Host**: localhost
- **Port**: 5432
- **Database**: `teak_db`
- **User**: `teak_user`
- **Password**: `teak_dev_password` (development only)

#### Production Database

- **Database**: `teak`
- **User**: `teak_user`
- **Password**: Set via `POSTGRES_PASSWORD` environment variable

### Docker Compose commands

```bash
# Navigate to docker directory first
cd docker

# Start services
docker-compose up

# Start in background
docker-compose up -d

# Rebuild and start
docker-compose up --build

# Stop services
docker-compose down

# View logs
docker-compose logs -f
```

## ⚙️ Environment Variables

### Development Environment

| Variable        | Default       | Description                  |
| --------------- | ------------- | ---------------------------- |
| `NODE_ENV`      | `development` | Node environment             |
| `FRONTEND_PORT` | `3000`        | Frontend development port    |
| `BACKEND_PORT`  | `3001`        | Backend development port     |
| `DATABASE_URL`  | (see below)   | PostgreSQL connection string |

### Production Environment

| Variable            | Default      | Description                  |
| ------------------- | ------------ | ---------------------------- |
| `PORT`              | `3000`       | Server port                  |
| `NODE_ENV`          | `production` | Node environment             |
| `POSTGRES_DB`       | `teak`       | PostgreSQL database name     |
| `POSTGRES_USER`     | `teak_user`  | PostgreSQL username          |
| `POSTGRES_PASSWORD` | (required)   | PostgreSQL password          |
| `DATABASE_URL`      | (see below)  | PostgreSQL connection string |

### Authentication & User Registration

| Variable                        | Default                 | Description                               |
| ------------------------------- | ----------------------- | ----------------------------------------- |
| `BETTER_AUTH_SECRET`            | (required)              | Secret key for Better Auth (min 32 chars) |
| `BETTER_AUTH_URL`               | `http://localhost:3000` | Base URL for authentication callbacks     |
| `ALLOW_MULTI_USER_REGISTRATION` | `false`                 | Allow multiple users to register          |

**User Registration Control:**

- By default, only one user can register in the system
- Set `ALLOW_MULTI_USER_REGISTRATION=true` to allow multiple users to register
- If multi-user registration is disabled and a user already exists, new registration attempts will be blocked with an appropriate error message

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

## 📄 License

MIT License - see LICENSE file for details.
