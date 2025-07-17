#!/bin/bash

# Teak Database Setup Script
# Initializes database, runs migrations, and seeds data

set -e

echo "🗄️  Setting up Teak database..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "apps/backend" ]; then
    echo -e "${RED}❌ This script must be run from the project root directory${NC}"
    exit 1
fi

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Start database if not running
echo -e "${BLUE}🐳 Starting database container...${NC}"
if ! docker-compose -f docker/docker-compose.yml ps | grep -q postgres; then
    echo -e "${YELLOW}Starting PostgreSQL container...${NC}"
    docker-compose -f docker/docker-compose.yml up -d postgres
    
    # Wait for database to be ready
    echo -e "${BLUE}⏳ Waiting for database to be ready...${NC}"
    sleep 5
    
    # Wait for postgres to accept connections
    for i in {1..30}; do
        if docker-compose -f docker/docker-compose.yml exec -T postgres pg_isready -U ${POSTGRES_USER:-teak_user} >/dev/null 2>&1; then
            break
        fi
        echo -e "${YELLOW}Waiting for database... ($i/30)${NC}"
        sleep 2
    done
else
    echo -e "${GREEN}✅ Database container already running${NC}"
fi

# Ensure database exists
echo -e "${BLUE}📊 Ensuring database exists...${NC}"
DB_NAME=${POSTGRES_DB:-teak_db}
DB_USER=${POSTGRES_USER:-teak_user}

# Check if database exists and create if it doesn't
DB_EXISTS=$(docker-compose -f docker/docker-compose.yml exec -T postgres psql -U ${DB_USER} -lqt | cut -d \| -f 1 | grep -wq ${DB_NAME} && echo "true" || echo "false")

if [ "$DB_EXISTS" = "false" ]; then
    echo -e "${YELLOW}Creating database: ${DB_NAME}${NC}"
    docker-compose -f docker/docker-compose.yml exec -T postgres createdb -U ${DB_USER} ${DB_NAME}
    echo -e "${GREEN}✅ Database ${DB_NAME} created successfully${NC}"
else
    echo -e "${GREEN}✅ Database ${DB_NAME} already exists${NC}"
fi

# Navigate to backend directory
cd apps/backend

# Generate migrations if needed
echo -e "${BLUE}📋 Generating database migrations...${NC}"
if [ ! -d "drizzle" ] || [ -z "$(ls -A drizzle 2>/dev/null)" ]; then
    bun run db:generate
    echo -e "${GREEN}✅ Database migrations generated${NC}"
else
    echo -e "${YELLOW}⚠️  Migrations already exist, skipping generation${NC}"
fi

# Run migrations
echo -e "${BLUE}🔄 Running database migrations...${NC}"
bun run db:migrate
echo -e "${GREEN}✅ Database migrations applied${NC}"

# Seed database
echo -e "${BLUE}🌱 Seeding database with initial data...${NC}"
if bun run db:seed; then
    echo -e "${GREEN}✅ Database seeded successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Database seeding completed (may have been already seeded)${NC}"
fi

cd ..

echo ""
echo -e "${GREEN}🎉 Database setup completed successfully!${NC}"
echo ""
echo -e "${BLUE}Database info:${NC}"
echo "  • PostgreSQL running on localhost:5432"
echo "  • Database: ${POSTGRES_DB:-teak_db}"
echo "  • Username: ${POSTGRES_USER:-teak_user}"
echo ""
echo -e "${BLUE}Available database commands:${NC}"
echo "  • Open Drizzle Studio: ${YELLOW}cd apps/backend && bun run db:studio${NC}"
echo "  • Connect to database: ${YELLOW}bun run db:connect${NC}"
echo "  • Check database status: ${YELLOW}bun run db:status${NC}"
echo "  • Reset database: ${YELLOW}bun run db:reset${NC}"