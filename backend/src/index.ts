import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { cache } from 'hono/cache';
import { serveStatic } from 'hono/bun';
import { auth } from './auth';
import { userRoutes } from './routes/users';

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  }
}>();

// Add logger middleware
app.use('*', logger());

// Enable CORS for development - includes Better Auth routes
app.use('*', cors({
  origin: ['http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Important for Better Auth cookies
}));

// Add caching for static assets
app.use('/assets/*', cache({
  cacheName: 'teak-assets',
  cacheControl: 'max-age=31536000', // 1 year
}));

// Better Auth middleware - extract user and session from request
app.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    c.set('user', null);
    c.set('session', null);
    return next();
  }

  c.set('user', session.user);
  c.set('session', session.session);
  return next();
});

// Mount Better Auth handler
app.on(['POST', 'GET'], '/api/auth/**', (c) => {
  return auth.handler(c.req.raw);
});

// Better Auth routes
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// API routes
app.route('/api/users', userRoutes);

// Auth-protected API routes
app.get('/api/session', (c) => {
  const session = c.get('session');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  return c.json({
    session,
    user
  });
});

app.get('/api/protected', (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  return c.json({
    message: 'This is a protected route',
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    }
  });
});

// Public API route
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    auth: 'better-auth enabled'
  });
});

// Serve static files from the frontend build with optimized caching
app.use('/assets/*', serveStatic({
  root: './apps/web/dist',
  onNotFound: (path) => {
    console.log(`Static file not found: ${path}`);
  }
}));

// Fallback for SPA routing - serve index.html for all non-API routes
app.get('*', async (c) => {
  try {
    const indexFile = Bun.file('./apps/web/dist/index.html');

    if (await indexFile.exists()) {
      const indexContent = await indexFile.text();

      // Add proper caching headers for index.html
      c.header('Cache-Control', 'public, max-age=0, must-revalidate');
      c.header('ETag', `"${await Bun.hash(indexContent)}"`);

      return c.html(indexContent);
    } else {
      return c.text('Frontend not built yet. Run "bun run build:frontend" first.', 404);
    }
  } catch (error) {
    return c.text('Error serving frontend files', 500);
  }
});

const port = parseInt(Bun.env['PORT'] || '3001');

console.log(`🚀 Server starting on port ${port}`);
console.log(` API endpoints: http://localhost:${port}/api/*`);

export default {
  port,
  fetch: app.fetch,
};

console.log(`✅ Server is running on http://localhost:${port}`);
