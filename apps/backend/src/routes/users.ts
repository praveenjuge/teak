import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, users } from '../db';

const userRoutes = new Hono();

// Get all users (for demo purposes)
userRoutes.get('/', async (c) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt));

    return c.json({ users: allUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// Get user by ID
userRoutes.get('/:id', async (c) => {
  try {
    const userId = c.req.param('id');
    const user = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user: user[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

export { userRoutes };
