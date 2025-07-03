import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { cache } from 'hono/cache';
import { serveStatic } from 'hono/bun';
import { auth } from './auth';
import { userRoutes } from './routes/users';
import { cardRoutes } from './routes/cards';

// App with type-safe context
const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  }
}>();

// Core middleware
app.use('*', logger());
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:8081'], // Add Expo development server
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Required for Better Auth cookies
}));

// Cache static assets for 1 year
app.use('/assets/*', cache({
  cacheName: 'teak-assets',
  cacheControl: 'max-age=31536000',
}));

// Auth middleware - extract user and session from request
app.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  c.set('user', session?.user || null);
  c.set('session', session?.session || null);
  return next();
});

// Better Auth handler - handle all HTTP methods
app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

// API routes
app.route('/api/users', userRoutes);
app.route('/api/cards', cardRoutes);

// Protected session endpoint
app.get('/api/session', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);

  return c.json({ session: c.get('session'), user });
});

// Protected API example
app.get('/api/protected', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Authentication required' }, 401);

  return c.json({
    message: 'This is a protected route',
    user: { id: user.id, email: user.email, name: user.name }
  });
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    auth: 'better-auth enabled'
  });
});

// Serve static files with optimized caching
app.use('/assets/*', serveStatic({
  root: './apps/web/dist',
  onNotFound: (path) => console.log(`Static file not found: ${path}`)
}));

// SPA fallback - serve index.html for all non-API routes
app.get('*', async (c) => {
  try {
    const indexFile = Bun.file('./apps/web/dist/index.html');

    if (!(await indexFile.exists())) {
      return c.text('Frontend not built yet. Run "bun run build:frontend" first.', 404);
    }

    const content = await indexFile.text();

    // Cache headers for index.html
    c.header('Cache-Control', 'public, max-age=0, must-revalidate');
    c.header('ETag', `"${await Bun.hash(content)}"`);

    return c.html(content);
  } catch {
    return c.text('Error serving frontend files', 500);
  }
});

const port = parseInt(Bun.env['PORT'] || '3001');

console.log(`🚀 Server starting on port ${port}`);
console.log(`📡 API endpoints: http://localhost:${port}/api/*`);
console.log(`✅ Server is running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
