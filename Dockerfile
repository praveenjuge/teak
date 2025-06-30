# Multi-stage Dockerfile for Teak App
# Stage 1: Build the frontend
FROM node:lts-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm ci --only=production

# Copy frontend source
COPY frontend/ ./

# Build the frontend
RUN npm run build

# Stage 2: Build the backend and final image
FROM node:lts-alpine AS final

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy backend package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY tsconfig.json ./
COPY backend/tsconfig.json ./backend/

# Install dependencies
RUN npm ci --only=production

# Copy backend source
COPY backend/ ./backend/

# Build backend TypeScript
RUN npm run build:backend

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

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]
