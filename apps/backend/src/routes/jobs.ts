import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { auth } from '../auth';
import { db } from '../db';
import { jobs } from '../db/schema';
import { JobService } from '../services/job/job-service';

// Create jobs router with type-safe context
export const jobRoutes = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Initialize job service
const jobService = new JobService();

// GET /api/jobs - List all jobs for the user
jobRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const userJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, user.id))
      .orderBy(desc(jobs.createdAt))
      .limit(50);

    return c.json(userJobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch jobs',
      },
      400
    );
  }
});

// POST /api/jobs/refetch-og-images - Start OG images refetch job
jobRoutes.post('/refetch-og-images', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const job = await jobService.createJob({
      type: 'refetch-og-images',
      userId: user.id,
      payload: {},
    });

    // Start the job processing asynchronously
    jobService.processJob(job.id).catch(console.error);

    return c.json(job, 201);
  } catch (error) {
    console.error('Error creating OG images refetch job:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create job',
      },
      400
    );
  }
});

// POST /api/jobs/refetch-screenshots - Start screenshots refetch job
jobRoutes.post('/refetch-screenshots', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const job = await jobService.createJob({
      type: 'refetch-screenshots',
      userId: user.id,
      payload: {},
    });

    // Start the job processing asynchronously
    jobService.processJob(job.id).catch(console.error);

    return c.json(job, 201);
  } catch (error) {
    console.error('Error creating screenshots refetch job:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create job',
      },
      400
    );
  }
});

// POST /api/jobs/refresh-ai-data - Start AI data refresh job
jobRoutes.post('/refresh-ai-data', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const job = await jobService.createJob({
      type: 'refresh-ai-data',
      userId: user.id,
      payload: {},
    });

    // Start the job processing asynchronously
    jobService.processJob(job.id).catch(console.error);

    return c.json(job, 201);
  } catch (error) {
    console.error('Error creating AI data refresh job:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create job',
      },
      400
    );
  }
});
