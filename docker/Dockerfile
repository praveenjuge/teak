# Multi-stage Dockerfile for single-image production deployment
# Stage 1: Frontend Build
FROM oven/bun:1-alpine AS frontend-builder

WORKDIR /app

# Copy frontend package files
COPY apps/web/package.json apps/web/bun.lock ./web/
COPY package.json bun.lock ./

# Install dependencies
RUN cd web && bun install --frozen-lockfile

# Copy frontend source
COPY apps/web ./web/

# Build frontend
RUN cd web && bun run build

# Stage 2: Backend Build
FROM oven/bun:1-alpine AS backend-builder

WORKDIR /app

# Copy backend package files
COPY backend/package.json ./backend/
COPY package.json ./

# Install dependencies
RUN cd backend && bun install --frozen-lockfile

# Copy backend source
COPY backend ./backend/

# Build backend
RUN cd backend && bun run build

# Stage 3: Final Production Image
FROM nginx:alpine

# Install supervisor, bun, and other dependencies
RUN apk add --no-cache \
    supervisor \
    bash \
    curl \
    postgresql-client \
    netcat-openbsd \
    nodejs \
    npm \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Create app user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Create necessary directories with proper permissions
RUN mkdir -p /app/frontend /app/backend /app/logs /var/log/supervisor /app/backend/uploads \
    && chown -R appuser:appgroup /app \
    && chmod -R 755 /app \
    && chown -R appuser:appgroup /var/log/supervisor

# Copy built frontend assets from frontend-builder
COPY --from=frontend-builder --chown=appuser:appgroup /app/web/dist /app/frontend

# Copy built backend from backend-builder
COPY --from=backend-builder --chown=appuser:appgroup /app/backend/dist /app/backend/dist
COPY --from=backend-builder --chown=appuser:appgroup /app/backend/package.json /app/backend/
COPY --from=backend-builder --chown=appuser:appgroup /app/backend/node_modules /app/backend/node_modules

# Copy backend source files needed at runtime
COPY --chown=appuser:appgroup backend/drizzle /app/backend/drizzle
COPY --chown=appuser:appgroup backend/drizzle.config.ts /app/backend/

# Copy configuration files
COPY --chown=appuser:appgroup docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=appuser:appgroup docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=appuser:appgroup docker/entrypoint.sh /app/entrypoint.sh

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf.dpkg-dist

# Make entrypoint executable
RUN chmod +x /app/entrypoint.sh

# Set environment variables with defaults
ENV NODE_ENV=production \
    PORT=80 \
    BACKEND_PORT=3001 \
    DATABASE_URL="" \
    BETTER_AUTH_SECRET="" \
    BETTER_AUTH_URL=""

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/health || exit 1

# Use entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]