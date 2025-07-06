#!/bin/bash

# Teak Dependencies Installation Script
# Installs all dependencies across the monorepo workspaces

set -e

echo "📦 Installing Teak project dependencies..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if bun is available
if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun is not installed. Please install Bun first: https://bun.sh${NC}"
    exit 1
fi

# Install root dependencies
echo -e "${BLUE}📦 Installing root dependencies...${NC}"
bun install

# Install backend dependencies
echo -e "${BLUE}📦 Installing backend dependencies...${NC}"
cd backend && bun install && cd ..

# Install web app dependencies
echo -e "${BLUE}📦 Installing web app dependencies...${NC}"
cd apps/web && bun install && cd ../..

# Install mobile app dependencies  
echo -e "${BLUE}📦 Installing mobile app dependencies...${NC}"
cd apps/mobile && bun install && cd ../..

echo -e "${GREEN}✅ All dependencies installed successfully!${NC}"
echo ""
echo -e "${BLUE}Installed packages for:${NC}"
echo "  • Root workspace (@teak/root)"
echo "  • Backend (@teak/backend)" 
echo "  • Web app (@teak/web)"
echo "  • Mobile app (@teak/mobile)"