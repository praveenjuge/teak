import type { AdminStatsResponse } from '@teak/shared-types';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, jobs, users } from '../db/schema';

export class StatisticsService {
  async getAdminStatistics(): Promise<AdminStatsResponse> {
    // Get overview statistics
    const [totalUsersResult] = await db
      .select({ count: count() })
      .from(users);

    const [totalCardsResult] = await db
      .select({ count: count() })
      .from(cards)
      .where(isNull(cards.deletedAt));

    const [totalJobsResult] = await db
      .select({ count: count() })
      .from(jobs);

    // Get cards by type
    const cardsByType = await db
      .select({
        type: cards.type,
        count: count(),
      })
      .from(cards)
      .where(isNull(cards.deletedAt))
      .groupBy(cards.type);

    // Get cards by user
    const cardsByUser = await db
      .select({
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        cardCount: count(cards.id),
      })
      .from(users)
      .leftJoin(cards, and(eq(cards.userId, users.id), isNull(cards.deletedAt)))
      .groupBy(users.id, users.name, users.email)
      .orderBy(sql`count(${cards.id}) DESC`)
      .limit(10);

    // Get recent card activity (last 7 days)
    const recentCardActivity = await db
      .select({
        date: sql<string>`DATE(${cards.createdAt})`,
        count: count(),
      })
      .from(cards)
      .where(
        and(
          isNull(cards.deletedAt),
          sql`${cards.createdAt} >= NOW() - INTERVAL '7 days'`
        )
      )
      .groupBy(sql`DATE(${cards.createdAt})`)
      .orderBy(sql`DATE(${cards.createdAt}) DESC`);

    // Get recent user registrations (last 7 days)
    const recentRegistrations = await db
      .select({
        date: sql<string>`DATE(${users.createdAt})`,
        count: count(),
      })
      .from(users)
      .where(sql`${users.createdAt} >= NOW() - INTERVAL '7 days'`)
      .groupBy(sql`DATE(${users.createdAt})`)
      .orderBy(sql`DATE(${users.createdAt}) DESC`);

    // Get active users (users with recent card activity)
    const activeUsers = await db
      .select({
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        lastActivity: sql<string>`MAX(${cards.createdAt})`,
        cardCount: count(cards.id),
      })
      .from(users)
      .leftJoin(cards, and(eq(cards.userId, users.id), isNull(cards.deletedAt)))
      .groupBy(users.id, users.name, users.email)
      .having(sql`MAX(${cards.createdAt}) >= NOW() - INTERVAL '30 days'`)
      .orderBy(sql`MAX(${cards.createdAt}) DESC`)
      .limit(10);

    // Get jobs by status
    const jobsByStatus = await db
      .select({
        status: jobs.status,
        count: count(),
      })
      .from(jobs)
      .groupBy(jobs.status);

    // Get jobs by type
    const jobsByType = await db
      .select({
        type: jobs.type,
        count: count(),
      })
      .from(jobs)
      .groupBy(jobs.type);

    // Calculate job success rate
    const [completedJobs] = await db
      .select({ count: count() })
      .from(jobs)
      .where(eq(jobs.status, 'completed'));

    const [failedJobs] = await db
      .select({ count: count() })
      .from(jobs)
      .where(eq(jobs.status, 'failed'));

    const totalCompletedAndFailed = completedJobs.count + failedJobs.count;
    const successRate = totalCompletedAndFailed > 0 
      ? (completedJobs.count / totalCompletedAndFailed) * 100 
      : 0;

    // Transform data into the expected format
    const cardsByTypeRecord: Record<string, number> = {};
    cardsByType.forEach(item => {
      cardsByTypeRecord[item.type] = item.count;
    });

    const jobsByStatusRecord: Record<string, number> = {};
    jobsByStatus.forEach(item => {
      jobsByStatusRecord[item.status] = item.count;
    });

    const jobsByTypeRecord: Record<string, number> = {};
    jobsByType.forEach(item => {
      jobsByTypeRecord[item.type] = item.count;
    });

    return {
      overview: {
        totalUsers: totalUsersResult.count,
        totalCards: totalCardsResult.count,
        totalJobs: totalJobsResult.count,
        storageUsed: '0 MB', // TODO: Calculate actual storage usage
      },
      cards: {
        total: totalCardsResult.count,
        byType: cardsByTypeRecord as AdminStatsResponse['cards']['byType'],
        byUser: cardsByUser,
        recentActivity: recentCardActivity,
      },
      users: {
        total: totalUsersResult.count,
        recentRegistrations,
        activeUsers,
      },
      jobs: {
        total: totalJobsResult.count,
        byStatus: jobsByStatusRecord as AdminStatsResponse['jobs']['byStatus'],
        byType: jobsByTypeRecord as AdminStatsResponse['jobs']['byType'],
        successRate: Math.round(successRate * 100) / 100,
      },
    };
  }
}