import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { cards } from '../db/schema';
import {
  createCardSchema,
  updateCardSchema,
  searchCardsSchema,
  cardIdSchema,
} from '../schemas/cards';
import { validateBody, validateQuery, validateParams, validateCardData } from '../utils/validation';
import { DatabaseSearchService } from '../services/search/DatabaseSearchService';

// Create cards router with type-safe context
export const cardRoutes = new Hono<{
  Variables: {
    user: any;
    session: any;
  }
}>();



// GET /api/cards - List all cards with optional search and filters
cardRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const query = validateQuery(c, searchCardsSchema);
    const { q, type, limit, offset, sort, order } = query;

    // Initialize search service
    const searchService = new DatabaseSearchService();

    // Use the search service to handle all search and filtering logic
    const result = await searchService.searchCards({
      query: q,
      type,
      limit,
      offset,
      sort,
      order,
      userId: user.id
    });

    return c.json(result);

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

