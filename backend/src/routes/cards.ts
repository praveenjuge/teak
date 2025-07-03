import { Hono } from 'hono';
import { eq, desc, asc, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards } from '../db/schema';
import {
  createCardSchema,
  updateCardSchema,
  searchCardsSchema,
  cardIdSchema,
} from '../schemas/cards';
import { validateBody, validateQuery, validateParams, validateCardData } from '../utils/validation';

// Create cards router with type-safe context
export const cardRoutes = new Hono<{
  Variables: {
    user: any;
    session: any;
  }
}>();

// GET /api/cards/search - Advanced search endpoint
cardRoutes.get('/search', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const query = validateQuery(c, searchCardsSchema);
    const { q, type, limit, offset } = query;

    if (!q) {
      return c.json({ error: 'Search query is required' }, 400);
    }

    // Build search query with ranking
    let whereClause = and(
      eq(cards.userId, user.id),
      isNull(cards.deletedAt)
    );

    // Add type filter if specified
    if (type) {
      whereClause = and(whereClause, eq(cards.type, type));
    }

    // Full-text search with ranking
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
        rank: sql<number>`
          ts_rank(
            to_tsvector('english', 
              COALESCE(${cards.data}->>'content', '') || ' ' ||
              COALESCE(${cards.data}->>'url', '') || ' ' ||
              COALESCE(${cards.data}->>'transcription', '') || ' ' ||
              COALESCE(${cards.data}->>'title', '') || ' ' ||
              COALESCE(${cards.data}->>'description', '')
            ),
            plainto_tsquery('english', ${q})
          )
        `
      })
      .from(cards)
      .where(
        and(
          whereClause,
          sql`
            to_tsvector('english', 
              COALESCE(${cards.data}->>'content', '') || ' ' ||
              COALESCE(${cards.data}->>'url', '') || ' ' ||
              COALESCE(${cards.data}->>'transcription', '') || ' ' ||
              COALESCE(${cards.data}->>'title', '') || ' ' ||
              COALESCE(${cards.data}->>'description', '')
            ) @@ plainto_tsquery('english', ${q})
          `
        )
      )
      .orderBy(desc(sql`ts_rank(
            to_tsvector('english', 
              COALESCE(${cards.data}->>'content', '') || ' ' ||
              COALESCE(${cards.data}->>'url', '') || ' ' ||
              COALESCE(${cards.data}->>'transcription', '') || ' ' ||
              COALESCE(${cards.data}->>'title', '') || ' ' ||
              COALESCE(${cards.data}->>'description', '')
            ),
            plainto_tsquery('english', ${q})
          )`))
      .limit(typeof limit === 'number' ? limit : 20)
      .offset(typeof offset === 'number' ? offset : 0);

    // Get total count for the search
    const countResult = await db

      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(
        and(
          whereClause,
          sql`
            to_tsvector('english', 
              COALESCE(${cards.data}->>'content', '') || ' ' ||
              COALESCE(${cards.data}->>'url', '') || ' ' ||
              COALESCE(${cards.data}->>'transcription', '') || ' ' ||
              COALESCE(${cards.data}->>'title', '') || ' ' ||
              COALESCE(${cards.data}->>'description', '')
            ) @@ plainto_tsquery('english', ${q})
          `
        )
      );
    const count = countResult && countResult[0] ? countResult[0].count : 0;

    return c.json({
      cards: searchResults,
      total: count,
      limit,
      offset,
      hasMore: (typeof offset === 'number' ? offset : 0) + (typeof limit === 'number' ? limit : 20) < count,
      query: q
    });

  } catch (error) {
    console.error('Error searching cards:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to search cards' }, 400);
  }
});

// GET /api/cards/stats - Get user's card statistics
cardRoutes.get('/stats', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Get card counts by type
    const stats = await db
      .select({
        type: cards.type,
        count: sql<number>`count(*)`
      })
      .from(cards)
      .where(
        and(
          eq(cards.userId, user.id),
          isNull(cards.deletedAt)
        )
      )
      .groupBy(cards.type);

    // Get total count
    const totalResult = await db
      .select({ total: sql<number>`count(*)` })
      .from(cards)
      .where(
        and(
          eq(cards.userId, user.id),
          isNull(cards.deletedAt)
        )
      );
    const total = totalResult && totalResult[0] ? totalResult[0].total : 0;

    return c.json({
      total,
      by_type: stats.reduce((acc, stat) => {
        acc[stat.type] = stat.count;
        return acc;
      }, {} as Record<string, number>)
    });

  } catch (error) {
    console.error('Error fetching card stats:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch card statistics' }, 400);
  }
});

// GET /api/cards - List all cards with optional search and filters
cardRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const query = validateQuery(c, searchCardsSchema);
    const { q, type, limit, offset, sort, order } = query;

    // Build the query
    let whereClause = and(
      eq(cards.userId, user.id),
      isNull(cards.deletedAt) // Only non-deleted cards
    );

    // Add type filter if specified
    if (type) {
      whereClause = and(whereClause, eq(cards.type, type));
    }

    // Always use the same select shape for dbQuery
    let effectiveWhereClause = whereClause;
    if (q) {
      const searchCondition = sql`
        to_tsvector('english', 
          COALESCE(${cards.data}->>'content', '') || ' ' ||
          COALESCE(${cards.data}->>'url', '') || ' ' ||
          COALESCE(${cards.data}->>'transcription', '') || ' ' ||
          COALESCE(${cards.data}->>'title', '') || ' ' ||
          COALESCE(${cards.data}->>'description', '')
        ) @@ plainto_tsquery('english', ${q})
      `;
      effectiveWhereClause = and(whereClause, searchCondition);
    }
    const sortColumn = sort === 'created_at' ? cards.createdAt :
      sort === 'updated_at' ? cards.updatedAt :
        cards.type;
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
        userId: cards.userId
      })
      .from(cards)
      .where(effectiveWhereClause)
      .orderBy(orderBy)
      .limit(typeof limit === 'number' ? limit : 20)
      .offset(typeof offset === 'number' ? offset : 0);

    // Get total count for pagination
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(cards).where(whereClause);
    const countResult = await countQuery;
    const count = countResult && countResult[0] ? countResult[0].count : 0;

    return c.json({
      cards: result,
      total: count,
      limit,
      offset,
      hasMore: (typeof offset === 'number' ? offset : 0) + (typeof limit === 'number' ? limit : 20) < count
    });

  } catch (error) {
    console.error('Error fetching cards:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch cards' }, 400);
  }
});

// GET /api/cards/:id - Get a specific card
cardRoutes.get('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const { id } = validateParams(c, cardIdSchema);

    const [card] = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.id, id),
          eq(cards.userId, user.id),
          isNull(cards.deletedAt)
        )
      )
      .limit(1);

    if (!card) {
      return c.json({ error: 'Card not found' }, 404);
    }

    return c.json(card);

  } catch (error) {
    console.error('Error fetching card:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch card' }, 400);
  }
});

// POST /api/cards - Create a new card
cardRoutes.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const body = await validateBody(c, createCardSchema);

    // Validate the card data based on its type
    validateCardData(body.type, body.data);

    const [newCard] = await db
      .insert(cards)
      .values({
        type: body.type,
        data: body.data,
        metaInfo: body.metaInfo || {},
        userId: user.id,
      })
      .returning();

    return c.json(newCard, 201);

  } catch (error) {
    console.error('Error creating card:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create card' }, 400);
  }
});

// PUT /api/cards/:id - Update a card
cardRoutes.put('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const { id } = validateParams(c, cardIdSchema);
    const body = await validateBody(c, updateCardSchema);

    // Check if card exists and belongs to user
    const [existingCard] = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.id, id),
          eq(cards.userId, user.id),
          isNull(cards.deletedAt)
        )
      )
      .limit(1);

    if (!existingCard) {
      return c.json({ error: 'Card not found' }, 404);
    }

    // Validate the card data if type or data is being updated
    if (body.type && body.data) {
      validateCardData(body.type, body.data);
    } else if (body.data && !body.type) {
      validateCardData(existingCard.type, body.data);
    }

    // Update the card
    const [updatedCard] = await db
      .update(cards)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(cards.id, id))
      .returning();

    return c.json(updatedCard);

  } catch (error) {
    console.error('Error updating card:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update card' }, 400);
  }
});

// DELETE /api/cards/:id - Soft delete a card
cardRoutes.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const { id } = validateParams(c, cardIdSchema);

    // Check if card exists and belongs to user
    const [existingCard] = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.id, id),
          eq(cards.userId, user.id),
          isNull(cards.deletedAt)
        )
      )
      .limit(1);

    if (!existingCard) {
      return c.json({ error: 'Card not found' }, 404);
    }

    // Soft delete the card
    await db
      .update(cards)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cards.id, id));

    return c.json({ message: 'Card deleted successfully' });

  } catch (error) {
    console.error('Error deleting card:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete card' }, 400);
  }
});

