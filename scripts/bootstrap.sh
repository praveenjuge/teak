#!/bin/bash

# Teak Bootstrap Script
# Full project setup including dependencies, database, and development environment

set -e

echo "🚀 Starting Teak project bootstrap..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}📋 Checking prerequisites...${NC}"

if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun is not installed. Please install Bun first: https://bun.sh${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first: https://docker.com${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
./scripts/install-deps.sh

# Setup database
echo -e "${BLUE}🗄️  Setting up database...${NC}"
./scripts/setup-db.sh

# Setup environment files
echo -e "${BLUE}⚙️  Setting up environment files...${NC}"
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env from .env.example${NC}"
    else
        echo -e "${YELLOW}⚠️  No .env.example found, skipping environment setup${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  .env already exists, skipping${NC}"
fi

# Final success message
echo ""
echo -e "${GREEN}🎉 Bootstrap completed successfully!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  • Start development: ${YELLOW}bun run dev${NC}"
echo "  • Start backend only: ${YELLOW}bun run dev:backend${NC}"
echo "  • Start frontend only: ${YELLOW}bun run dev:frontend${NC}"
echo "  • Start mobile app: ${YELLOW}bun run dev:mobile${NC}"
echo ""
echo -e "${BLUE}Database tools:${NC}"
echo "  • Open Drizzle Studio: ${YELLOW}cd backend && bun run db:studio${NC}"
echo "  • Connect to DB: ${YELLOW}bun run db:connect${NC}"
echo "  • Check DB status: ${YELLOW}bun run db:status${NC}"
echo ""
echo -e "${GREEN}Happy coding! 🎯${NC}"