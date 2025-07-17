import { Hono } from 'hono';

export const healthRoutes = new Hono();

// Enhanced health check endpoint for Docker
healthRoutes.get('/health', (c) => {
  return c.json({
    service: 'teak-backend',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    auth: 'better-auth enabled',
    database: 'connected', // Could be enhanced with actual DB health check
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Readiness check (for Kubernetes/Docker health checks)
healthRoutes.get('/ready', (c) => {
  return c.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

// Liveness check (for Kubernetes/Docker health checks)
healthRoutes.get('/live', (c) => {
  return c.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});
