import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { healthRoutes } from './health';
import { cardRoutes } from './routes/cards';
import { jobRoutes } from './routes/jobs';
import { userRoutes } from './routes/users';

// App with type-safe context
const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Core middleware
app.use('*', logger());

// Environment-aware CORS configuration
const isOriginAllowed = (origin: string): boolean => {
  // Development origins
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://localhost:8081'].includes(origin);
  }

  // Production origins from environment variable
  if (process.env.ALLOWED_ORIGINS) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) =>
      o.trim()
    );
    return allowedOrigins.includes(origin);
  }

  return false; // Reject all in production if no allowed origins set
};

app.use(
  '*',
  cors({
    origin: (origin) => (isOriginAllowed(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'Range',
      'Content-Range',
      'Content-Length',
    ],
    credentials: true, // Required for Better Auth cookies
  })
);

// Body size limit for file uploads (200MB)
app.use(
  '*',
  bodyLimit({
    maxSize: 200 * 1024 * 1024, // 200MB
    onError: (c) => {
      return c.json(
        {
          error: 'Request body too large. Maximum file size is 200MB.',
        },
        413
      );
    },
  })
);

// Auth middleware - extract user and session from request
app.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  c.set('user', session?.user || null);
  c.set('session', session?.session || null);
  return next();
});

// Better Auth handler - handle all HTTP methods
app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

// Helper function to set audio CORS headers
const setAudioCorsHeaders = (c: Context, contentType: string) => {
  c.header('Content-Type', contentType);
  c.header('Accept-Ranges', 'bytes');
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  c.header(
    'Access-Control-Allow-Headers',
    'Range, Content-Range, Content-Length'
  );
};

// API routes
app.route('/api/users', userRoutes);
app.route('/api/cards', cardRoutes);
app.route('/api/jobs', jobRoutes);
app.route('/api', healthRoutes);

// Serve uploaded files with proper headers for audio
app.use('/api/data/*', (c, next) => {
  const path = c.req.path;
  const filePath = path.replace('/api/data', '');
  const ext = filePath.split('.').pop()?.toLowerCase();

  // Set appropriate content type and headers for audio files
  const audioTypes: Record<string, string> = {
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
  };

  if (ext && audioTypes[ext]) {
    setAudioCorsHeaders(c, audioTypes[ext]);
  }

  return next();
});

// Protected file serving - ensure users can only access their own files
app.use('/api/data/*', async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Authentication required to access files' }, 401);
  }

  const requestPath = c.req.path.replace('/api/data/', '');
  const pathParts = requestPath.split('/');
  
  // Check if the requested file belongs to the authenticated user
  if (pathParts.length > 0 && pathParts[0] !== user.id) {
    return c.json({ error: 'Access denied' }, 403);
  }

  return next();
});

app.use(
  '/api/data/*',
  serveStatic({
    root: '/data',
    rewriteRequestPath: (path) => path.replace('/api/data', ''),
  })
);

// Protected session endpoint
app.get('/api/session', (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  return c.json({ session: c.get('session'), user });
});

// Protected API example
app.get('/api/protected', (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  return c.json({
    message: 'This is a protected route',
    user: { id: user.id, email: user.email, name: user.name },
  });
});

// Serve static files with optimized caching
app.use(
  '/assets/*',
  serveStatic({
    root: './apps/web/dist',
  })
);

// SPA fallback - serve index.html for all non-API routes
app.get('*', async (c) => {
  try {
    const indexFile = Bun.file('./apps/web/dist/index.html');

    if (!(await indexFile.exists())) {
      return c.text(
        'Frontend not built yet. Run "bun run build:frontend" first.',
        404
      );
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

const port = '3001';

console.log(`🚀 Server starting on port ${port}`);
console.log(`📡 API endpoints: http://localhost:${port}/api/*`);
console.log(`✅ Server is running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
