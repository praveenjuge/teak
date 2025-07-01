#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Database connection helper scripts for development

show_help() {
    echo -e "${BLUE}🗄️  Teak Database Management Scripts${NC}"
    echo -e "${YELLOW}Usage: $0 [command]${NC}"
    echo ""
    echo "Commands:"
    echo "  connect     - Connect to development database with psql"
    echo "  backup      - Backup development database"
    echo "  restore     - Restore database from backup"
    echo "  reset       - Reset development database (removes all data)"
    echo "  logs        - Show PostgreSQL logs"
    echo "  status      - Check database status"
    echo "  help        - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 connect"
    echo "  $0 backup"
    echo "  $0 restore backup.sql"
    echo ""
}

connect_db() {
    echo -e "${BLUE}🔌 Connecting to development database...${NC}"
    docker exec -it teak-postgres-dev psql -U teak_user -d teak_dev
}

backup_db() {
    local backup_file="backup_$(date +%Y%m%d_%H%M%S).sql"
    echo -e "${BLUE}💾 Creating database backup: ${backup_file}${NC}"
    docker exec teak-postgres-dev pg_dump -U teak_user teak_dev > "$backup_file"
    echo -e "${GREEN}✅ Backup created: ${backup_file}${NC}"
}

restore_db() {
    local backup_file=$1
    if [ -z "$backup_file" ]; then
        echo -e "${RED}❌ Please provide backup file path${NC}"
        echo -e "${YELLOW}Usage: $0 restore backup.sql${NC}"
        exit 1
    fi
    
    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}❌ Backup file not found: $backup_file${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}🔄 Restoring database from: ${backup_file}${NC}"
    docker exec -i teak-postgres-dev psql -U teak_user teak_dev < "$backup_file"
    echo -e "${GREEN}✅ Database restored successfully${NC}"
}

reset_db() {
    echo -e "${YELLOW}⚠️  This will DELETE ALL DATA in the development database!${NC}"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}🔄 Resetting development database...${NC}"
        docker-compose -f docker/docker-compose.dev.yml down -v
        docker-compose -f docker/docker-compose.dev.yml up postgres-dev -d
        echo -e "${GREEN}✅ Database reset complete${NC}"
    else
        echo -e "${YELLOW}❌ Operation cancelled${NC}"
    fi
}

show_logs() {
    echo -e "${BLUE}📋 Showing PostgreSQL logs...${NC}"
    docker logs teak-postgres-dev -f
}

check_status() {
    echo -e "${BLUE}📊 Checking database status...${NC}"
    
    if docker ps | grep -q teak-postgres-dev; then
        echo -e "${GREEN}✅ PostgreSQL container is running${NC}"
        
        if docker exec teak-postgres-dev pg_isready -U teak_user -d teak_dev > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Database is accepting connections${NC}"
            
            # Get database info
            echo -e "${BLUE}📊 Database Information:${NC}"
            docker exec teak-postgres-dev psql -U teak_user -d teak_dev -c "
                SELECT 
                    'Database Size' as metric, 
                    pg_size_pretty(pg_database_size('teak_dev')) as value
                UNION ALL
                SELECT 
                    'Tables Count', 
                    count(*)::text 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                UNION ALL
                SELECT 
                    'PostgreSQL Version', 
                    version();
            " -t
        else
            echo -e "${RED}❌ Database is not accepting connections${NC}"
        fi
    else
        echo -e "${RED}❌ PostgreSQL container is not running${NC}"
        echo -e "${YELLOW}💡 Run 'bun run dev' to start the development environment${NC}"
    fi
}

# Main script logic
case $1 in
    connect)
        connect_db
        ;;
    backup)
        backup_db
        ;;
    restore)
        restore_db $2
        ;;
    reset)
        reset_db
        ;;
    logs)
        show_logs
        ;;
    status)
        check_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        if [ -z "$1" ]; then
            show_help
        else
            echo -e "${RED}❌ Unknown command: $1${NC}"
            show_help
            exit 1
        fi
        ;;
esac
