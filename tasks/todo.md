# Single-Image Production Docker Setup - Todo List

## Current Analysis Summary
The current Docker setup has a single container running both frontend and backend services. While functional, it's not production-ready due to several concerns:

- **No reverse proxy**: Direct exposure of application server
- **No static file optimization**: Missing Nginx for efficient static asset serving
- **Security concerns**: No proper user isolation or security headers
- **No SSL/TLS configuration**: Missing HTTPS setup
- **Limited monitoring**: No health checks or logging configuration
- **Not Docker Hub ready**: No easy single-image deployment option

## Proposed Single-Image Architecture
A **single Docker image** that contains:
- **Nginx** as web server and reverse proxy
- **Built Frontend Assets** (React app) served by Nginx
- **Backend API** (Hono.js) running alongside Nginx
- **Process Manager** (supervisord) to manage both services
- **External Database** connection via environment variables

## Single-Image Benefits
1. **Easy deployment**: Single `docker run` command
2. **Docker Hub ready**: Easy to publish and distribute
3. **Production-ready**: Proper reverse proxy with Nginx
4. **Efficient static serving**: Nginx serves frontend assets
5. **Proper API proxying**: Nginx proxies /api/* to backend
6. **Environment configurable**: All settings via environment variables
7. **Health checks**: Built-in monitoring for both services

## Todo Items

### High Priority
- [x] Analyze current Docker setup and identify production readiness gaps
- [ ] Create single-image production directory structure (docker/single-image/)
- [ ] Create single Dockerfile with multi-stage build (frontend + backend + nginx)
- [ ] Create nginx.conf for serving static files and proxying API requests
- [ ] Create supervisord.conf for managing both nginx and backend processes
- [ ] Create entrypoint.sh script for container startup and configuration
- [ ] Test single-image deployment and verify all services work correctly

### Medium Priority
- [ ] Add environment variable configuration for database and app settings
- [ ] Add health checks for both nginx and backend services
- [ ] Configure security measures (non-root user, proper permissions)
- [ ] Create docker-compose.yml for easy local testing with database

### Low Priority
- [ ] Create Docker Hub publishing configuration and documentation

## Architecture Details

### Multi-Stage Build Process
1. **Frontend Build Stage**: Build React app with Vite
2. **Backend Build Stage**: Build Hono.js API with Bun
3. **Final Stage**: Nginx + built assets + backend + supervisord

### Container Structure
```
/app/
├── frontend/          # Built React assets
├── backend/           # Built API server
├── nginx/             # Nginx configuration
├── supervisord/       # Process management
└── entrypoint.sh      # Container startup script
```

### Port Configuration
- **External Port**: 80 (configurable via PORT env var)
- **Internal API Port**: 3001 (Nginx proxies to this)
- **Database**: External connection via DATABASE_URL

### Usage Examples
```bash
# Simple deployment
docker run -p 80:80 -e DATABASE_URL=postgres://... username/teak

# With custom configuration
docker run -p 80:80 \
  -e DATABASE_URL=postgres://... \
  -e PORT=3000 \
  -e NODE_ENV=production \
  username/teak
```

## Implementation Complete

All single-image production Docker setup has been completed and moved to the `docker/` directory:

### Files Created/Updated:
- `docker/Dockerfile` - Multi-stage build (frontend + backend + nginx)
- `docker/nginx.conf` - Reverse proxy and static file serving
- `docker/supervisord.conf` - Process management for nginx + backend
- `docker/entrypoint.sh` - Container startup and configuration script
- `docker/docker-compose.yml` - Complete setup with database
- `docker/.env.example` - Environment configuration template
- `docker/build.sh` - Build and deployment script
- `docker/README.md` - Complete documentation
- `backend/src/health.ts` - Enhanced health check endpoints

### Architecture:
- **Single Docker image** containing complete application
- **Nginx** serves frontend and proxies API requests
- **Supervisord** manages both nginx and backend processes  
- **Multi-stage build** for optimized image size
- **Production-ready** with security measures and health checks
- **Docker Hub ready** for easy distribution

### Usage:
```bash
cd docker
docker-compose up --build
# or
./build.sh -u username -p  # Build and push to Docker Hub
```

**Status**: ✅ Ready for testing and deployment