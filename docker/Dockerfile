# Multi-stage Dockerfile for Teak App with Bun
# Stage 1: Build the frontend
FROM oven/bun:1-alpine AS frontend-builder

WORKDIR /app/frontend

# Bun is already installed in the oven/bun image

# Copy frontend package files
COPY apps/web/package.json apps/web/bun.lock* ./

# Install frontend dependencies
RUN bun install --frozen-lockfile

# Copy frontend source
COPY apps/web/ ./

# Build the frontend
RUN bun run build

# Stage 2: Build the backend and final image
FROM oven/bun:1-alpine AS final

# Install PostgreSQL client for runtime database operations
RUN apk add --no-cache \
    postgresql-client \
    netcat-openbsd \
    bash

# Bun is already installed in the oven/bun image

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 bun && \
    adduser -S -u 1001 -G bun bun

# Copy backend package files
COPY package.json bun.lock* ./
COPY backend/tsconfig.json ./backend/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

# Build backend
RUN bun run build:backend

# Generate Drizzle migrations
RUN cd backend && bun run ../node_modules/.bin/drizzle-kit generate

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/frontend/dist ./apps/web/dist

# Set correct ownership
RUN chown -R bun:bun /app
USER bun

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE $PORT

# Create a production startup script that waits for PostgreSQL
RUN echo '#!/bin/bash\n\
    set -e\n\
    echo "🚀 Starting Teak production application..."\n\
    echo "🗄️  Waiting for PostgreSQL to be ready..."\n\
    while ! nc -z postgres 5432; do\n\
    echo "   Waiting for PostgreSQL..."\n\
    sleep 2\n\
    done\n\
    echo "✅ PostgreSQL is ready!"\n\
    echo "🔄 Running database migrations..."\n\
    cd /app/backend && bun run ../node_modules/.bin/drizzle-kit migrate\n\
    cd /app\n\
    echo "✅ Database migrations completed!"\n\
    echo "🔥 Starting application..."\n\
    exec bun start\n\
    ' > /app/start-prod.sh && chmod +x /app/start-prod.sh

# Start the application with the startup script
CMD ["/app/start-prod.sh"]
