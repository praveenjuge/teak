# Teak

## 🏗️ Architecture

- **Runtime**: Bun
- **Backend**: Hono.js (TypeScript)
- **Frontend**: React 19 + Vite (TypeScript)
- **Containerization**: Docker

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
│   └── mobile/              # Mobile app
├── Dockerfile               # Multi-stage build with Bun
├── docker-compose.yml       # Container orchestration
├── .dockerignore            # Docker ignore patterns
├── .env.example             # Environment variables template
├── package.json             # Root package.json
└── README.md                # This file
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Bun 1.0+ (for local development)

### 🐳 Run with Docker

1. **Clone and navigate to the project:**
   ```bash
   git clone git@github.com:praveenjuge/teak.git
   cd teak
   ```

2. **Build and run with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

3. **Access the application:**
   - Frontend & API: http://localhost:3000
   - API endpoints: http://localhost:3000/api

### 🔧 Local Development

1. **Install Bun (if not already installed):**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Install dependencies:**
   ```bash
   bun run install:all
   ```

3. **Start development servers:**
   ```bash
   bun dev
   ```

4. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3000/api

## 🔧 Available Scripts

- `bun dev` - Start both backend and frontend in development mode
- `bun build` - Build both backend and frontend for production
- `bun start` - Start the production server
- `bun run install:all` - Install all dependencies (root + web app)

- `bun run dev:backend` - Start backend development server with watch mode
- `bun run build:backend` - Build backend using Bun bundler
- `bun run type-check` - Type check backend code

- `bun run dev:frontend` - Start frontend development server
- `bun run build:frontend` - Build frontend for production

## 🐳 Docker Commands

### Build the image

```bash
docker build -t teak .
```

### Run the container

```bash
docker run -p 3000:3000 -e PORT=3000 teak
```

### Docker Compose commands

```bash
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

| Variable   | Default       | Description      |
| ---------- | ------------- | ---------------- |
| `PORT`     | `3000`        | Server port      |
| `NODE_ENV` | `development` | Node environment |

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

## 📄 License

MIT License - see LICENSE file for details.
