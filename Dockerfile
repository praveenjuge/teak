# Multi-stage Dockerfile for Teak App with Bun
# Stage 1: Build the frontend
FROM oven/bun:1 AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/bun.lockb* ./

# Install frontend dependencies
RUN bun install --frozen-lockfile

# Copy frontend source
COPY frontend/ ./

# Build the frontend
RUN bun run build

# Stage 2: Build the backend and final image
FROM oven/bun:1 AS final

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nodejs

# Copy backend package files
COPY package.json bun.lockb* ./
COPY backend/tsconfig.json ./backend/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

# Build backend
RUN bun run build:backend

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Set correct ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE $PORT

# Start the application with Bun
CMD ["bun", "start"]
