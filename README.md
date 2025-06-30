# Teak

## 🏗️ Architecture

- **Backend**: Hono.js (TypeScript)
- **Frontend**: React 19 + Vite (TypeScript)
- **Containerization**: Multi-stage Docker build

## 📁 Project Structure

```
teak/
├── backend/
│   ├── src/
│   │   └── index.ts          # Hono.js server with API routes
│   └── tsconfig.json         # Backend TypeScript config
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # React app with API integration
│   │   ├── App.css           # Styling
│   │   └── main.tsx          # React entry point
│   ├── vite.config.ts        # Vite config with proxy
│   └── package.json          # Frontend dependencies
├── Dockerfile               # Multi-stage build
├── docker-compose.yml       # Container orchestration
├── .dockerignore            # Docker ignore patterns
├── .env.example             # Environment variables template
├── package.json             # Root package.json
└── README.md                # This file
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)

### 🐳 Run with Docker (Recommended)

1. **Clone and navigate to the project:**
   ```bash
   git clone <your-repo-url>
   cd teak
   ```

2. **Build and run with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

3. **Access the application:**
   - Frontend & API: http://localhost:3000
   - API endpoints: http://localhost:3000/api/*

### 🔧 Local Development

1. **Install dependencies:**
   ```bash
   npm run install:all
   ```

2. **Start development servers:**
   ```bash
   npm run dev
   ```
   This starts both backend (port 3001) and frontend (port 3000) with
   hot-reload.

3. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3000/api (proxied to port 3001)

## 🐳 Docker Commands

### Build the image

```bash
docker build -t teak .
```

### Run the container

```bash
docker run -p 3000:3000 -e PORT=3000 teak
```

### Run with custom port

```bash
docker run -p 8080:8080 -e PORT=8080 teak
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
