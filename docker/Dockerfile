# Multi-stage Dockerfile for single-image production deployment
# Stage 1: Shared Types Build
FROM oven/bun AS shared-types-builder

WORKDIR /workspace

# Copy workspace package files
COPY package.json bun.lock ./
COPY packages/shared-types/package.json ./packages/shared-types/

# Install dependencies
RUN bun install

# Copy shared types source
COPY packages/shared-types ./packages/shared-types/

# Build shared types
RUN cd packages/shared-types && bun run build

# Stage 2: Frontend Build
FROM oven/bun AS frontend-builder

WORKDIR /workspace

# Copy workspace package files
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/

# Copy built shared types from previous stage
COPY --from=shared-types-builder /workspace/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=shared-types-builder /workspace/packages/shared-types/package.json ./packages/shared-types/

# Install dependencies
RUN bun install

# Copy frontend source
COPY apps/web ./apps/web/

# Build frontend
RUN cd apps/web && bun run build

# Stage 3: Backend Build
FROM oven/bun AS backend-builder

WORKDIR /workspace

# Copy workspace package files
COPY package.json bun.lock ./
COPY backend/package.json ./backend/
COPY packages/shared-types/package.json ./packages/shared-types/

# Copy built shared types from previous stage
COPY --from=shared-types-builder /workspace/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=shared-types-builder /workspace/packages/shared-types/package.json ./packages/shared-types/

# Install dependencies
RUN bun install

# Copy backend source
COPY backend ./backend/

# Build backend
RUN cd backend && bun run build

# Stage 4: Final Production Image
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
RUN mkdir -p /app/frontend /app/backend /app/logs /var/log/supervisor /data \
    && chown -R appuser:appgroup /app \
    && chmod -R 755 /app \
    && chown -R appuser:appgroup /var/log/supervisor \
    && chown -R appuser:appgroup /data \
    && chmod -R 755 /data

# Copy built frontend assets from frontend-builder
COPY --from=frontend-builder --chown=appuser:appgroup /workspace/apps/web/dist /app/frontend

# Copy built backend from backend-builder
COPY --from=backend-builder --chown=appuser:appgroup /workspace/backend/dist /app/backend/dist
COPY --from=backend-builder --chown=appuser:appgroup /workspace/backend/package.json /app/backend/
COPY --from=backend-builder --chown=appuser:appgroup /workspace/backend/node_modules /app/backend/node_modules

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
ENV POSTGRES_DB="" \
    POSTGRES_USER="" \
    POSTGRES_PASSWORD="" \
    BETTER_AUTH_SECRET="" \
    BETTER_AUTH_URL=""

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/health || exit 1

# Use entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]