import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();

// Enable CORS for development
app.use('*', cors({
  origin: ['http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// API routes
app.get('/api/users', (c) => {
  const users = [
    { id: 1, name: 'John Doe', email: 'john@example.com', role: 'admin' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'user' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'user' },
  ];

  return c.json({
    success: true,
    data: users,
    count: users.length
  });
});

app.get('/api/stats', (c) => {
  return c.json({
    success: true,
    data: {
      totalUsers: 1250,
      activeUsers: 890,
      revenue: 45750.25,
      growth: 12.5
    }
  });
});

app.post('/api/users', async (c) => {
  const body = await c.req.json();

  // Simple validation
  if (!body.name || !body.email) {
    return c.json({
      success: false,
      error: 'Name and email are required'
    }, 400);
  }

  const newUser = {
    id: Math.floor(Math.random() * 1000) + 100,
    name: body.name,
    email: body.email,
    role: body.role || 'user',
    createdAt: new Date().toISOString()
  };

  return c.json({
    success: true,
    data: newUser,
    message: 'User created successfully'
  }, 201);
});

// Serve static assets manually
app.get('/assets/*', async (c) => {
  const requestPath = c.req.path;
  const filePath = path.join(__dirname, '../frontend/dist', requestPath);

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath);
      const ext = path.extname(filePath);

      // Set appropriate content type
      let contentType = 'application/octet-stream';
      if (ext === '.js') contentType = 'application/javascript';
      else if (ext === '.css') contentType = 'text/css';
      else if (ext === '.html') contentType = 'text/html';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.svg') contentType = 'image/svg+xml';

      c.header('Content-Type', contentType);
      return c.body(content);
    } catch {
      return c.text('File not found', 404);
    }
  }

  return c.text('File not found', 404);
});

// Fallback for SPA routing - serve index.html for all non-API routes
app.get('*', async (c) => {
  try {
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    if (existsSync(indexPath)) {
      const indexContent = readFileSync(indexPath, 'utf-8');
      return c.html(indexContent);
    } else {
      return c.text('Frontend not built yet. Run "bun run build:frontend" first.', 404);
    }
  } catch (error) {
    return c.text('Error serving frontend files', 500);
  }
});

const port = parseInt(process.env.PORT || '3001');

console.log(`🚀 Server starting on port ${port}`);
console.log(` API endpoints: http://localhost:${port}/api/*`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`✅ Server is running on http://localhost:${info.port}`);
});
