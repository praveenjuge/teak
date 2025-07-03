# Teak

- Runtime: Bun
- Backend: Hono.js (TypeScript)
- Web App: React 19 + Vite (TypeScript)
- Mobile App: React Native with Expo
- Database: PostgreSQL 17
- Containerization: Docker

## 📁 Project Structure

```
teak/
├── backend/
│   ├── src/
│   │   └── index.ts         # Hono.js server with API routes
│   └── tsconfig.json        # Backend TypeScript config
├── apps/
│   ├── web/                 # Frontend React app
│   │   ├── src/
│   │   │   ├── App.tsx      # React app with API integration
│   │   │   ├── App.css      # Styling
│   │   │   └── main.tsx     # React entry point
│   │   ├── vite.config.ts   # Vite config with proxy
│   │   └── package.json     # Frontend dependencies
│   └── mobile/              # Expo React Native Mobile App
├── docker/                  # Docker configuration
├── scripts/                 # Utility scripts
├── .env.example             # Environment variables template
├── package.json             # Root package.json
└── README.md                # This file
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Bun 1.0+ (for local development)
- PostgreSQL 17 (automatically provided via Docker)

### Local Development

1. **Clone and navigate to the project:**

   ```bash
   git clone git@github.com:praveenjuge/teak.git
   cd teak
   ```

2. **Start development environment:**

   ```bash
   bun run dev
   ```

   This will:
   - 🐳 Build and start Docker containers
   - 🔥 Enable hot reload for both frontend and backend
   - 📝 Automatically open VS Code in the current directory
   - 🗄️ Initialize PostgreSQL database with sample schema
   - 🌐 Wait for services to be ready, then open your browser at
     http://localhost:3000
   - 📡 Backend API available at http://localhost:3001
   - 🗃️ PostgreSQL database available at localhost:5432

## 🗄️ Database

### PostgreSQL Setup

The project uses PostgreSQL 17 as the database, which is automatically
configured and started through Docker Compose.

#### Development Database

- **Host**: localhost
- **Port**: 5432
- **Database**: `teak_dev`
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

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

## 📄 License

MIT License - see LICENSE file for details.
