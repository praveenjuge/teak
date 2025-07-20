import { Hono } from 'hono';
import type { auth } from '../auth';
import { StatisticsService } from '../services/statistics-service';

// Create admin router with type-safe context
export const adminRoutes = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Initialize services
const statisticsService = new StatisticsService();

// GET /api/admin/stats - Get system-wide statistics
adminRoutes.get('/stats', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // TODO: Add proper admin role check when roles are implemented
    // For now, this is accessible to all authenticated users
    // In a real app, you'd check if user.role === 'admin' or similar

    const stats = await statisticsService.getAdminStatistics();
    return c.json(stats);
  } catch (error) {
    console.error('Error fetching admin statistics:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch statistics',
      },
      500
    );
  }
});