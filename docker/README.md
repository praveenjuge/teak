# Teak - Single Image Production Deployment

A production-ready single Docker image containing the complete Teak application with Nginx reverse proxy, React frontend, and Hono.js backend.

## 🚀 Quick Start

### Option 1: Docker Run (Simplest)

```bash
# With external PostgreSQL database
docker run -p 80:80 \
  -e DATABASE_URL=postgresql://user:password@host:5432/database \
  -e BETTER_AUTH_SECRET=your-super-secret-key \
  -e BETTER_AUTH_URL=http://localhost:80 \
  username/teak:latest
```

### Option 2: Docker Compose (Recommended for Development)

```bash
# Clone the repository
git clone https://github.com/username/teak.git
cd teak/docker

# Copy and edit environment variables
cp .env.example .env
nano .env

# Start the application with database
docker-compose up -d

# View logs
docker-compose logs -f teak
```

### Option 3: Build and Run Locally

```bash
# Build the image
docker build -f docker/Dockerfile -t teak:local .

# Run with your database
docker run -p 80:80 \
  -e DATABASE_URL=your-database-url \
  -e BETTER_AUTH_SECRET=your-secret \
  teak:local
```

## 📋 Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `BETTER_AUTH_SECRET` | Secret key for authentication | `your-super-secret-key-here` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_PORT` | Backend server port | `3001` |
| `NODE_ENV` | Node.js environment | `production` |
| `BETTER_AUTH_URL` | Base URL for authentication | `http://localhost:80` |

## 🏗️ Architecture

This single image contains:

- **Nginx** - Web server and reverse proxy (port 80)
- **React Frontend** - Built static assets served by Nginx
- **Hono.js Backend** - API server (internal port 3001)
- **Supervisord** - Process manager for both services

### Request Flow

```
Client Request → Nginx (port 80) → {
  /api/* → Backend API (port 3001)
  /uploads/* → Static file serving
  /* → React Frontend (SPA)
}
```

## 🔧 Development

### Building the Image

```bash
# From the project root
docker build -f docker/Dockerfile -t teak:dev .
```

### Testing the Build

```bash
# Start with compose (includes database)
cd docker
docker-compose up --build

# Or run standalone (requires external database)
docker run -p 80:80 \
  -e DATABASE_URL=postgresql://localhost:5432/teak \
  -e BETTER_AUTH_SECRET=test-secret \
  teak:dev
```

### Development with Hot Reload

For development with hot reload, use the existing development setup:

```bash
# From project root
bun run dev
```

## 📊 Monitoring & Health Checks

### Health Endpoints

- **Application Health**: `GET /health`
- **API Health**: `GET /api/health`
- **Backend Readiness**: `GET /api/ready`
- **Backend Liveness**: `GET /api/live`

### Container Health Check

The Docker container includes built-in health checks:

```bash
# Check container health
docker ps  # Look for "healthy" status

# View health check logs
docker inspect container-name | grep Health -A 10
```

### Logs

```bash
# View all logs
docker logs container-name

# View Nginx logs
docker exec container-name tail -f /var/log/nginx/access.log

# View backend logs
docker exec container-name tail -f /var/log/supervisor/backend.out.log
```

## 🔒 Security Features

- Non-root user execution for backend processes
- Security headers configured in Nginx
- File upload restrictions and validation
- CORS properly configured
- Content Security Policy headers
- XSS and clickjacking protection

## 🚀 Production Deployment

### Docker Hub

```bash
# Tag for Docker Hub
docker tag teak:latest username/teak:latest
docker tag teak:latest username/teak:v1.0.0

# Push to Docker Hub
docker push username/teak:latest
docker push username/teak:v1.0.0
```

### Cloud Deployment Examples

#### AWS ECS/Fargate

```json
{
  "family": "teak",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "teak",
      "image": "username/teak:latest",
      "portMappings": [{"containerPort": 80}],
      "environment": [
        {"name": "DATABASE_URL", "value": "postgresql://..."},
        {"name": "BETTER_AUTH_SECRET", "value": "..."}
      ]
    }
  ]
}
```

#### Google Cloud Run

```bash
gcloud run deploy teak \
  --image=username/teak:latest \
  --port=80 \
  --set-env-vars="DATABASE_URL=postgresql://...,BETTER_AUTH_SECRET=..." \
  --allow-unauthenticated
```

#### Railway

```bash
# Deploy to Railway
railway login
railway init
railway add username/teak:latest
railway up
```

## 📁 Project Structure

```
docker/
├── Dockerfile              # Multi-stage build
├── nginx.conf              # Nginx configuration
├── supervisord.conf        # Process management
├── entrypoint.sh          # Container startup script
├── docker-compose.yml     # Local development
├── .env.example           # Environment template
└── README.md              # This file
```

## 🤝 Contributing

1. Make changes to the application code
2. Test with the single-image build:
   ```bash
   docker-compose -f docker/docker-compose.yml up --build
   ```
3. Ensure all health checks pass
4. Submit pull request

## 📝 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 🆘 Troubleshooting

### Common Issues

**Container fails to start**
- Check environment variables are set correctly
- Verify database is accessible from container
- Check logs: `docker logs container-name`

**Frontend not loading**
- Verify build completed successfully
- Check Nginx logs: `docker exec container-name tail -f /var/log/nginx/error.log`

**API not responding**
- Check backend logs: `docker exec container-name tail -f /var/log/supervisor/backend.err.log`
- Verify database connection
- Check health endpoint: `curl http://localhost:80/api/health`

**File uploads not working**
- Check uploads directory permissions
- Verify file size limits in Nginx config
- Check backend logs for file processing errors

### Support

For issues and questions:
- GitHub Issues: [https://github.com/username/teak/issues](https://github.com/username/teak/issues)
- Documentation: [https://docs.teak.app](https://docs.teak.app)