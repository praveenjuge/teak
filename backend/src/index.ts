import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';

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

// Serve static files from the frontend build
app.use('/assets/*', serveStatic({
  root: './frontend/dist'
}));

// Fallback for SPA routing - serve index.html for all non-API routes
app.get('*', async (c) => {
  try {
    const indexFile = Bun.file('./frontend/dist/index.html');

    if (await indexFile.exists()) {
      const indexContent = await indexFile.text();
      return c.html(indexContent);
    } else {
      return c.text('Frontend not built yet. Run "bun run build:frontend" first.', 404);
    }
  } catch (error) {
    return c.text('Error serving frontend files', 500);
  }
});

const port = parseInt(Bun.env.PORT || '3001');

console.log(`🚀 Server starting on port ${port}`);
console.log(` API endpoints: http://localhost:${port}/api/*`);

export default {
  port,
  fetch: app.fetch,
};

console.log(`✅ Server is running on http://localhost:${port}`);
