# Stage 1: Shared Types Build
FROM oven/bun AS shared-types-builder

WORKDIR /workspace

# Copy workspace root and shared packages manifests only
COPY package.json bun.lock ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-queries/package.json ./packages/shared-queries/

# Install dependencies for shared packages only
RUN bun install --frozen-lockfile

# Copy shared packages source
COPY packages/shared-types ./packages/shared-types/
COPY packages/shared-queries ./packages/shared-queries/

# Build shared packages
RUN cd packages/shared-types && bun run build && \
    cd ../shared-queries && bun run build

# Stage 2: Frontend Build
FROM oven/bun AS frontend-builder

WORKDIR /workspace

# Copy workspace root and frontend manifests only
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-queries/package.json ./packages/shared-queries/

# Copy built shared packages from previous stage
COPY --from=shared-types-builder /workspace/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=shared-types-builder /workspace/packages/shared-types/package.json ./packages/shared-types/
COPY --from=shared-types-builder /workspace/packages/shared-queries/dist ./packages/shared-queries/dist
COPY --from=shared-types-builder /workspace/packages/shared-queries/package.json ./packages/shared-queries/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy frontend source
COPY apps/web ./apps/web/

# Build frontend
RUN cd apps/web && bun run build

# Stage 3: Backend Build
FROM oven/bun AS backend-builder

WORKDIR /workspace

# Copy workspace root and backend manifests only
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-queries/package.json ./packages/shared-queries/

# Copy built shared packages from previous stage
COPY --from=shared-types-builder /workspace/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=shared-types-builder /workspace/packages/shared-types/package.json ./packages/shared-types/
COPY --from=shared-types-builder /workspace/packages/shared-queries/dist ./packages/shared-queries/dist
COPY --from=shared-types-builder /workspace/packages/shared-queries/package.json ./packages/shared-queries/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy backend source
COPY apps/backend ./apps/backend/

# Build backend
RUN cd apps/backend && bun run build

# Stage 4: Final Production Image
FROM nginx:alpine

# Add labels for better metadata
LABEL org.opencontainers.image.title="Teak Application" \
      org.opencontainers.image.description="Streamlined personal knowledge hub for creative minds" \
      org.opencontainers.image.vendor="praveenjuge" \
      maintainer="hello@praveenjuge.com"

# Install supervisor, bun, and essential dependencies
RUN apk add --no-cache \
    supervisor \
    bash \
    curl \
    postgresql-client \
    netcat-openbsd \
    ca-certificates \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Create app user and directories with proper permissions
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    mkdir -p /app/frontend /app/backend /app/logs /var/log/supervisor /data && \
    chown -R appuser:appgroup /app /var/log/supervisor /data && \
    chmod -R 755 /app /data

# Copy built frontend assets from frontend-builder
COPY --from=frontend-builder --chown=appuser:appgroup /workspace/apps/web/dist /app/frontend

# Copy built backend from backend-builder
COPY --from=backend-builder --chown=appuser:appgroup /workspace/apps/backend/dist /app/backend/dist
COPY --from=backend-builder --chown=appuser:appgroup /workspace/apps/backend/package.json /app/backend/
COPY --from=backend-builder --chown=appuser:appgroup /workspace/apps/backend/node_modules /app/backend/node_modules

# Copy backend source files needed at runtime
COPY --chown=appuser:appgroup apps/backend/drizzle /app/backend/drizzle
COPY --chown=appuser:appgroup apps/backend/drizzle.config.ts /app/backend/

# Copy configuration files and set permissions
COPY --chown=appuser:appgroup docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=appuser:appgroup docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=appuser:appgroup docker/entrypoint.sh /app/entrypoint.sh
RUN rm -f /etc/nginx/conf.d/default.conf.dpkg-dist && \
    chmod +x /app/entrypoint.sh

# Set environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/health || exit 1

# Use entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]