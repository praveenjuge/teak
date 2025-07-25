import {
  type CardType,
  cardIdSchema,
  createCardSchema,
  createCardWithFileSchema,
  searchCardsSchema,
  updateCardSchema,
} from '@teak/shared-types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { auth } from '../auth';
import { db } from '../db';
import { cards } from '../db/schema';
import {
  fileUploadMiddleware,
  getFormField,
  getUploadedFile,
} from '../middleware/file-upload';
import { CardService } from '../services/card/card-service';
import { DatabaseSearchService } from '../services/search/DatabaseSearchService';
import {
  validateBody,
  validateCardData,
  validateParams,
  validateQuery,
} from '../utils/validation';

// Create cards router with type-safe context
export const cardRoutes = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
    uploadedFiles: File[];
    formData: FormData;
  };
}>();

// Initialize card service
const cardService = new CardService();

// GET /api/cards - List all cards with optional search and filters
cardRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const query = validateQuery(c, searchCardsSchema);
    const { q, type, tags, limit, offset, sort, order } = query;

    // Parse tags from comma-separated string to array
    const parsedTags = tags
      ? tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined;

    // Initialize search service
    const searchService = new DatabaseSearchService();

    // Use the search service to handle all search and filtering logic
    const result = await searchService.searchCards({
      query: q,
      type,
      tags: parsedTags,
      limit,
      offset,
      sort,
      order,
      userId: user.id,
    });

    return c.json(result);
  } catch (error) {
    console.error('Error fetching cards:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch cards',
      },
      400
    );
  }
});

// GET /api/cards/tags - Get all available tags with counts
cardRoutes.get('/tags', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Query to get all tags from both AI tags and regular tags
    const result = await db
      .select({
        id: cards.id,
        aiTags: cards.aiTags,
        metaInfoTags: sql<string>`${cards.metaInfo}->>'tags'`,
      })
      .from(cards)
      .where(and(eq(cards.userId, user.id), isNull(cards.deletedAt)));

    // Process results to count tags
    const tagCounts = new Map<string, number>();

    result.forEach((card) => {
      // Process AI tags
      if (card.aiTags && Array.isArray(card.aiTags)) {
        card.aiTags.forEach((tag: string) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      }

      // Process regular tags
      if (card.metaInfoTags) {
        try {
          const regularTags = JSON.parse(card.metaInfoTags);
          if (Array.isArray(regularTags)) {
            regularTags.forEach((tag: string) => {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            });
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }
    });

    // Convert map to array and sort by count (desc) then by name (asc)
    const tags = Array.from(tagCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return c.json({ tags });
  } catch (error) {
    console.error('Error fetching tags:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch tags',
      },
      400
    );
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
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch card',
      },
      400
    );
  }
});

// POST /api/cards - Create a new card
cardRoutes.post('/', fileUploadMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const contentType = c.req.header('content-type');

    if (contentType?.includes('multipart/form-data')) {
      // Handle file upload request
      const type = getFormField(c, 'type');
      const dataField = getFormField(c, 'data');
      const metaInfoField = getFormField(c, 'metaInfo');

      if (!type) {
        return c.json({ error: 'Card type is required' }, 400);
      }

      // Parse and validate form data
      const formData = createCardWithFileSchema.parse({
        type,
        data: dataField,
        metaInfo: metaInfoField,
      });

      // Get uploaded file for media types
      const file = getUploadedFile(c, 'file');

      // Create card using service
      const newCard = await cardService.createCard(
        {
          type: formData.type as CardType,
          data: formData.data || {},
          metaInfo: formData.metaInfo,
          file,
        },
        user.id
      );

      return c.json(newCard, 201);
    }
    // Handle JSON request (backward compatibility)
    const body = await validateBody(c, createCardSchema);

    // Create card using service
    const newCard = await cardService.createCard(
      {
        type: body.type,
        data: body.data,
        metaInfo: body.metaInfo,
      },
      user.id
    );

    return c.json(newCard, 201);
  } catch (error) {
    console.error('Error creating card:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create card',
      },
      400
    );
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
      await validateCardData(body.type, body.data);
    } else if (body.data && !body.type) {
      await validateCardData(existingCard.type, body.data);
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
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update card',
      },
      400
    );
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
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete card',
      },
      400
    );
  }
});
