import type { SearchOptions, SearchResult } from '@teak/shared-types';
import { and, asc, desc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { db } from '../../db';
import { cards } from '../../db/schema';
import { SearchAndSortService } from './search-and-sort-service';

export class DatabaseSearchService extends SearchAndSortService {
  async searchCards(options: SearchOptions): Promise<SearchResult> {
    const {
      query,
      type,
      tags,
      limit = 20,
      offset = 0,
      sort = 'created_at',
      order = 'desc',
      userId,
    } = options;

    // Build base where clause
    let whereClause = and(eq(cards.userId, userId), isNull(cards.deletedAt));

    // Add type filter if specified
    if (type) {
      whereClause = and(whereClause, eq(cards.type, type));
    }

    // Add tag filter if specified
    if (tags && tags.length > 0) {
      // Create tag filter for both AI tags and regular tags
      const tagFilter = sql`(
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${cards.aiTags}) as ai_tag
          WHERE ai_tag = ANY(${sql.raw(`ARRAY[${tags.map((tag: string) => `'${tag.replace(/'/g, "''")}'`).join(',')}]`)})
        ) OR 
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${cards.metaInfo}->'tags') as regular_tag
          WHERE regular_tag = ANY(${sql.raw(`ARRAY[${tags.map((tag: string) => `'${tag.replace(/'/g, "''")}'`).join(',')}]`)})
        )
      )`;
      whereClause = and(whereClause, tagFilter);
    }

    // Determine if we need full-text search with ranking
    if (query) {
      return await this.searchWithRanking(whereClause, query, limit, offset);
    }
    return await this.searchWithSorting(
      whereClause,
      sort,
      order,
      limit,
      offset
    );
  }

  private async searchWithRanking(
    whereClause: SQL,
    query: string,
    limit: number,
    offset: number
  ): Promise<SearchResult> {
    // Full-text search with ranking
    const searchCondition = sql`
      to_tsvector('english', 
        COALESCE(${cards.data}->>'content', '') || ' ' ||
        COALESCE(${cards.data}->>'url', '') || ' ' ||
        COALESCE(${cards.data}->>'transcription', '') || ' ' ||
        COALESCE(${cards.data}->>'title', '') || ' ' ||
        COALESCE(${cards.data}->>'description', '')
      ) @@ plainto_tsquery('english', ${query})
    `;

    const effectiveWhereClause = and(whereClause, searchCondition);

    const searchResults = await db
      .select({
        id: cards.id,
        type: cards.type,
        data: cards.data,
        metaInfo: cards.metaInfo,
        createdAt: cards.createdAt,
        updatedAt: cards.updatedAt,
        deletedAt: cards.deletedAt,
        userId: cards.userId,
        aiSummary: cards.aiSummary,
        aiTags: cards.aiTags,
        aiTranscript: cards.aiTranscript,
        aiProcessedAt: cards.aiProcessedAt,
        rank: sql<number>`
          ts_rank(
            to_tsvector('english', 
              COALESCE(${cards.data}->>'content', '') || ' ' ||
              COALESCE(${cards.data}->>'url', '') || ' ' ||
              COALESCE(${cards.data}->>'transcription', '') || ' ' ||
              COALESCE(${cards.data}->>'title', '') || ' ' ||
              COALESCE(${cards.data}->>'description', '')
            ),
            plainto_tsquery('english', ${query})
          )
        `,
      })
      .from(cards)
      .where(effectiveWhereClause)
      .orderBy(
        desc(sql`ts_rank(
        to_tsvector('english', 
          COALESCE(${cards.data}->>'content', '') || ' ' ||
          COALESCE(${cards.data}->>'url', '') || ' ' ||
          COALESCE(${cards.data}->>'transcription', '') || ' ' ||
          COALESCE(${cards.data}->>'title', '') || ' ' ||
          COALESCE(${cards.data}->>'description', '')
        ),
        plainto_tsquery('english', ${query})
      )`)
      )
      .limit(limit)
      .offset(offset);

    // Get total count for the search
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(effectiveWhereClause);

    const total = countResult?.[0] ? countResult[0].count : 0;

    return {
      cards: searchResults,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      query,
    };
  }

  private async searchWithSorting(
    whereClause: SQL,
    sort: string,
    order: string,
    limit: number,
    offset: number
  ): Promise<SearchResult> {
    // Regular sorting without search
    let sortColumn = cards.createdAt; // Default to created_at
    if (sort === 'created_at') {
      sortColumn = cards.createdAt;
    } else if (sort === 'updated_at') {
      sortColumn = cards.updatedAt;
    } else {
      sortColumn = cards.type;
    }
    const orderBy = order === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const result = await db
      .select({
        id: cards.id,
        type: cards.type,
        data: cards.data,
        metaInfo: cards.metaInfo,
        createdAt: cards.createdAt,
        updatedAt: cards.updatedAt,
        deletedAt: cards.deletedAt,
        userId: cards.userId,
        aiSummary: cards.aiSummary,
        aiTags: cards.aiTags,
        aiTranscript: cards.aiTranscript,
        aiProcessedAt: cards.aiProcessedAt,
      })
      .from(cards)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(whereClause);

    const total = countResult?.[0] ? countResult[0].count : 0;

    return {
      cards: result,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }
}
