#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Teak Application...${NC}"

# Validate required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ ERROR: DATABASE_URL environment variable is required${NC}"
    echo "Example: DATABASE_URL=postgresql://user:password@host:5432/database"
    exit 1
fi

if [ -z "$BETTER_AUTH_SECRET" ]; then
    echo -e "${RED}❌ ERROR: BETTER_AUTH_SECRET environment variable is required${NC}"
    echo "Generate a secret key and set it as environment variable"
    exit 1
fi

# Set default values for optional variables
export BACKEND_PORT=${BACKEND_PORT:-3001}
export NODE_ENV=${NODE_ENV:-production}
export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"http://localhost:80"}

echo -e "${YELLOW}📋 Configuration:${NC}"
echo "  NODE_ENV: $NODE_ENV"
echo "  BACKEND_PORT: $BACKEND_PORT"
echo "  BETTER_AUTH_URL: $BETTER_AUTH_URL"
echo "  DATABASE_URL: [REDACTED]"

# Wait for database to be ready
echo -e "${YELLOW}⏳ Waiting for database to be ready...${NC}"
until pg_isready -d "$DATABASE_URL" -q; do
    echo "  Database not ready, waiting..."
    sleep 2
done
echo -e "${GREEN}✅ Database is ready!${NC}"

# Navigate to backend directory
cd /app/backend

# Run database migrations
echo -e "${YELLOW}🔄 Running database migrations...${NC}"
if bun x drizzle-kit migrate; then
    echo -e "${GREEN}✅ Database migrations completed successfully!${NC}"
else
    echo -e "${RED}❌ Database migrations failed!${NC}"
    exit 1
fi

# Create uploads directory if it doesn't exist
echo -e "${YELLOW}📁 Setting up uploads directory...${NC}"
mkdir -p /app/backend/uploads/{audio,video,image}
chown -R appuser:appgroup /app/backend/uploads
chmod -R 755 /app/backend/uploads

# Verify backend build exists
if [ ! -f "/app/backend/dist/index.js" ]; then
    echo -e "${RED}❌ Backend build not found at /app/backend/dist/index.js${NC}"
    exit 1
fi

# Verify frontend build exists
if [ ! -d "/app/frontend" ] || [ ! -f "/app/frontend/index.html" ]; then
    echo -e "${RED}❌ Frontend build not found at /app/frontend${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All checks passed!${NC}"

# Verify all components are ready
echo -e "${YELLOW}🔍 Verifying application components...${NC}"
echo "  ✓ Frontend build: $(ls -la /app/frontend/index.html 2>/dev/null | wc -l) files"
echo "  ✓ Backend build: $(ls -la /app/backend/dist/index.js 2>/dev/null | wc -l) files"
echo "  ✓ Nginx config: $(ls -la /etc/nginx/conf.d/default.conf 2>/dev/null | wc -l) files"
echo "  ✓ Database migrations: completed"

# Create log directories
mkdir -p /var/log/supervisor
mkdir -p /app/logs
chown -R appuser:appgroup /app/logs

echo -e "${GREEN}🎉 Starting services with supervisord...${NC}"
echo -e "${YELLOW}📊 You can monitor the application at:${NC}"
echo -e "  🌐 Frontend: http://localhost:${PORT}"
echo -e "  🔌 API: http://localhost:${PORT}/api"
echo -e "  ❤️  Health: http://localhost:${PORT}/health"

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf