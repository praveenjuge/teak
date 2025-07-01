#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Starting Teak development environment with Docker...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Function to wait for PostgreSQL
wait_for_postgres() {
    echo -e "${YELLOW}⏳ Waiting for PostgreSQL to be ready...${NC}"
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec teak-postgres-dev pg_isready -U teak_user -d teak_dev > /dev/null 2>&1; then
            echo -e "${GREEN}✅ PostgreSQL is ready!${NC}"
            return 0
        fi
        
        if [ $((attempt % 5)) -eq 0 ]; then
            echo -e "${YELLOW}   Still waiting for PostgreSQL... (${attempt}/${max_attempts})${NC}"
        fi
        
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ PostgreSQL failed to start within expected time${NC}"
    return 1
}

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local service_name=$2
    local max_attempts=60
    local attempt=1
    
    echo -e "${YELLOW}⏳ Waiting for ${service_name} to be ready...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|404\|301\|302"; then
            echo -e "${GREEN}✅ ${service_name} is ready!${NC}"
            return 0
        fi
        
        if [ $((attempt % 10)) -eq 0 ]; then
            echo -e "${YELLOW}   Still waiting for ${service_name}... (${attempt}/${max_attempts})${NC}"
        fi
        
        sleep 1
        ((attempt++))
    done
    
    echo -e "${RED}❌ ${service_name} failed to start within expected time${NC}"
    return 1
}

# Function to open VS Code
open_vscode() {
    echo -e "${PURPLE}📝 Opening VS Code...${NC}"
    
    # Try different VS Code commands based on OS and installation
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - try different VS Code installations
        if command -v code &> /dev/null; then
            code . &
        elif [ -d "/Applications/Visual Studio Code.app" ]; then
            open -a "Visual Studio Code" . &
        else
            echo -e "${YELLOW}⚠️  VS Code not found. Please install VS Code or add 'code' to your PATH${NC}"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v code &> /dev/null; then
            code . &
        elif command -v code-insiders &> /dev/null; then
            code-insiders . &
        else
            echo -e "${YELLOW}⚠️  VS Code not found. Please install VS Code${NC}"
        fi
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        # Windows
        if command -v code &> /dev/null; then
            code . &
        else
            echo -e "${YELLOW}⚠️  VS Code not found. Please install VS Code or add 'code' to your PATH${NC}"
        fi
    fi
}

# Function to open browser
open_browser() {
    echo -e "${GREEN}🌐 Opening browser at http://localhost:3000${NC}"
    
    # Detect OS and open browser accordingly
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        open http://localhost:3000 &
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        (xdg-open http://localhost:3000 2>/dev/null || sensible-browser http://localhost:3000 2>/dev/null) &
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        # Windows
        start http://localhost:3000 &
    fi
}

# Function to handle services after Docker is up
handle_post_startup() {
    # Wait for PostgreSQL first
    if wait_for_postgres; then
        # Wait for backend to be ready
        if wait_for_service "http://localhost:3001" "Backend API"; then
            # Wait for frontend to be ready
            if wait_for_service "http://localhost:3000" "Frontend"; then
                echo -e "${GREEN}🎉 All services are ready!${NC}"
                
                # Open VS Code first
                open_vscode
                
                # Small delay before opening browser
                sleep 2
                
                # Open browser
                open_browser
                
                echo -e "${GREEN}✨ Development environment is fully ready!${NC}"
                echo -e "${BLUE}📱 Frontend: http://localhost:3000${NC}"
                echo -e "${BLUE}🔌 Backend API: http://localhost:3001${NC}"
                echo -e "${BLUE}🗄️ Database: postgresql://teak_user:teak_dev_password@localhost:5432/teak_dev${NC}"
            fi
        fi
    fi
}

# Start the post-startup handler in background
handle_post_startup &

echo -e "${YELLOW}📦 Building and starting containers...${NC}"
echo -e "${BLUE}🔥 Hot reload is enabled - your changes will be reflected automatically!${NC}"
echo -e "${BLUE}📱 Frontend: http://localhost:3000${NC}"
echo -e "${BLUE}🔌 Backend API: http://localhost:3001${NC}"
echo -e "${BLUE}🗄️ Database: postgresql://teak_user:teak_dev_password@localhost:5432/teak_dev${NC}"
echo -e "${YELLOW}⏹️ Press Ctrl+C to stop the development environment${NC}"

# Start Docker Compose
docker-compose -f docker/docker-compose.dev.yml up --build

# Cleanup on exit
echo -e "${YELLOW}🧹 Cleaning up...${NC}"
docker-compose -f docker/docker-compose.dev.yml down
