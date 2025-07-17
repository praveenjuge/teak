#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to setup Bun version
setup_bun() {
    local bun_command="bun --version"
    echo "$bun_command"
}

# Function to detect terminal and open new tab
open_terminal_tab() {
    local title="$1"
    local command="$2"
    local full_command="$command"
    
    # Detect the operating system and terminal
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
            # iTerm2
            osascript -e "tell application \"iTerm2\"
                tell current window
                    create tab with default profile
                    tell current session
                        write text \"cd '$PROJECT_ROOT' && $full_command\"
                    end tell
                end tell
            end tell"
        elif [[ "$TERM_PROGRAM" == "Apple_Terminal" ]]; then
            # Terminal.app
            osascript -e "tell application \"Terminal\"
                do script \"cd '$PROJECT_ROOT' && $full_command\"
            end tell"
        else
            # Try iTerm2 first, then Terminal.app
            if command -v osascript &> /dev/null; then
                osascript -e "tell application \"iTerm2\"
                    tell current window
                        create tab with default profile
                        tell current session
                            write text \"cd '$PROJECT_ROOT' && $full_command\"
                        end tell
                    end tell
                end tell" 2>/dev/null || \
                osascript -e "tell application \"Terminal\"
                    do script \"cd '$PROJECT_ROOT' && $full_command\"
                end tell"
            fi
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v gnome-terminal &> /dev/null; then
            gnome-terminal --tab --title="$title" -- bash -c "cd '$PROJECT_ROOT' && $full_command; exec bash"
        elif command -v konsole &> /dev/null; then
            konsole --new-tab -e bash -c "cd '$PROJECT_ROOT' && $full_command; exec bash"
        elif command -v xterm &> /dev/null; then
            xterm -T "$title" -e bash -c "cd '$PROJECT_ROOT' && $full_command; exec bash" &
        else
            print_warning "No supported terminal found. Running command in background..."
            cd "$PROJECT_ROOT" && eval "$full_command" &
        fi
    else
        print_warning "Unsupported operating system. Running command in background..."
        cd "$PROJECT_ROOT" && eval "$full_command" &
    fi
}

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    print_error "Docker not found. Please install Docker Desktop."
    exit 1
fi

if ! docker info &> /dev/null; then
    print_error "Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check if PostgreSQL is available
if ! command -v psql &> /dev/null; then
    print_warning "PostgreSQL client (psql) not found. Database management commands may not work."
fi

# Project root directory
PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$PROJECT_ROOT"

# Check for .env file and create from example if it doesn't exist
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        print_status "Creating .env file from .env.example..."
        cp .env.example .env
        print_warning "Please update the .env file with your actual values before running in production."
    else
        print_error ".env.example file not found. Please create environment configuration."
        exit 1
    fi
fi

# Start PostgreSQL using Docker Compose
print_status "Starting PostgreSQL with Docker Compose..."

# Set default environment variables if not present in .env
export POSTGRES_DB=${POSTGRES_DB:-teak_db}
export POSTGRES_USER=${POSTGRES_USER:-teak_user}
export POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-teak_dev_password}

# Clean up any orphaned containers first
docker-compose -f docker/docker-compose.yml down --remove-orphans 2>/dev/null || true

# Start PostgreSQL
docker-compose -f docker/docker-compose.yml up -d postgres

# Wait for PostgreSQL to be ready
print_status "Waiting for PostgreSQL to be ready..."
max_attempts=30
attempts=0
while [ $attempts -lt $max_attempts ]; do
    if docker-compose -f docker/docker-compose.yml exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &> /dev/null; then
        print_status "PostgreSQL is ready!"
        break
    fi
    ((attempts++))
    print_status "Waiting for PostgreSQL... (${attempts}/${max_attempts})"
    sleep 2
done

if [ $attempts -eq $max_attempts ]; then
    print_error "PostgreSQL failed to start within expected time. Check Docker logs:"
    print_error "docker-compose -f docker/docker-compose.yml logs postgres"
    exit 1
fi

print_status "PostgreSQL started successfully!"
print_status "Database: $POSTGRES_DB, User: $POSTGRES_USER, Port: 5432"

# Check Bun version
print_status "Using Bun runtime..."
if command -v bun &> /dev/null; then
    print_status "Bun version: $(bun --version)"
else
    print_error "Bun not found. Please install Bun."
    exit 1
fi

# Install dependencies
print_status "Installing dependencies..."
bun install

# Install frontend dependencies
print_status "Installing frontend dependencies..."
cd apps/web && bun install && cd ../..

# Install mobile dependencies
print_status "Installing mobile dependencies..."
cd apps/mobile && bun install && cd ../..

# Check if database needs migration
print_status "Checking database status..."
cd apps/backend
if ! bunx drizzle-kit check 2>/dev/null; then
    print_status "Running database migrations..."
    bunx drizzle-kit migrate
fi
cd ../..

# Open terminal tabs for development
print_status "Opening terminal tabs..."

# Give a moment for PostgreSQL to settle
sleep 2

# Open backend tab
print_status "Starting backend server..."
open_terminal_tab "Backend" "source .env && echo 'Starting backend server...' && bun run dev:backend"

# Wait a moment between tabs
sleep 1

# Open frontend tab
print_status "Starting frontend server..."
open_terminal_tab "Frontend" "echo 'Starting frontend server...' && bun run --bun dev:frontend"

# Wait a moment between tabs
sleep 1

# Open database management tab
print_status "Opening database management tab..."
open_terminal_tab "Database" "echo 'Database Management Commands:' && echo '  bun run db:studio  - Open Drizzle Studio' && echo '  psql -h localhost -U $POSTGRES_USER -d $POSTGRES_DB - Connect to database' && echo '  docker-compose -f docker/docker-compose.yml logs postgres - View PostgreSQL logs' && echo '  docker-compose -f docker/docker-compose.yml stop postgres - Stop PostgreSQL' && echo '' && echo 'PostgreSQL running in Docker on localhost:5432'"

print_status "Development environment is ready!"
print_status "Services started:"
print_status "  ✓ PostgreSQL: localhost:5432 (Docker)"
print_status "  ✓ Backend API: localhost:3001 (Local)"
print_status "  ✓ Frontend: localhost:3000 (Local)"
print_status ""
print_status "Terminal tabs opened for backend, frontend, and database management."
print_status ""
print_status "To stop PostgreSQL: docker-compose -f docker/docker-compose.yml stop postgres"
print_status ""
print_status "Happy coding! 🚀"