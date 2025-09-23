import { createMcpHandler, experimental_withMcpAuth as withMcpAuth } from '@vercel/mcp-adapter';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@teak/convex';

// Helper function to get an authenticated Convex client
async function getAuthenticatedConvexClient(authInfo?: { extra?: { userId?: string } }) {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  
  // If we have auth info from MCP with a verified user
  if (authInfo?.extra?.userId) {
    console.log('Creating authenticated Convex client for user:', authInfo.extra.userId);
    
    // Use Clerk client to get user's JWT token
    try {
      // Get the authenticated user's token for Convex
      const clerkAuth = await auth();
      
      // Since we have the user ID from OAuth, we can get their Convex token
      // The user has already been verified by the OAuth flow
      const token = await clerkAuth.getToken({ 
        template: 'convex'
      });
      
      if (token) {
        console.log('Successfully got Convex token for authenticated user');
        convex.setAuth(token);
      } else {
        console.log('No Convex token available for user');
      }
    } catch (error) {
      console.error('Error getting Convex token:', error);
    }
  } else {
    console.log('No auth info provided, using unauthenticated client');
  }
  
  return convex;
}

const handler = createMcpHandler((server) => {
  console.log('MCP handler initialized');
  
  // Card CRUD Operations
  server.tool(
    'teak_create_card',
    'Create a new card in Teak knowledge base',
    {
      content: {
        type: 'string',
        description: 'Main content of the card',
      },
    },
    async ({ content }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        const cardId = await convex.mutation(api.cards.createCard, {
          content,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully created card with ID: ${cardId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to create card: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'teak_get_card',
    'Retrieve a specific card by ID',
    {
      id: {
        type: 'string',
        description: 'The ID of the card to retrieve',
      },
    },
    async ({ id }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        const card = await convex.query(api.cards.getCard, { id });

        if (!card) {
          return {
            content: [
              {
                type: 'text',
                text: `Card with ID ${id} not found`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(card, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to retrieve card: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'teak_update_card',
    'Update an existing card',
    {
      id: {
        type: 'string',
        description: 'The ID of the card to update',
      },
      content: {
        type: 'string',
        description: 'Updated content of the card',
      },
      url: {
        type: 'string',
        description: 'Updated URL for the card',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Updated tags for the card',
      },
      notes: {
        type: 'string',
        description: 'Updated notes for the card',
      },
    },
    async ({ id, content, url, tags, notes }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        await convex.mutation(api.cards.updateCard, {
          id,
          content,
          url,
          tags,
          notes,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully updated card with ID: ${id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to update card: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'teak_delete_card',
    'Soft delete a card (move to trash)',
    {
      id: {
        type: 'string',
        description: 'The ID of the card to delete',
      },
    },
    async ({ id }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        await convex.mutation(api.cards.updateCardField, { 
          cardId: id, 
          field: "delete" 
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted card with ID: ${id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to delete card: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'teak_search_cards',
    'Search across all card content with filters',
    {
      searchQuery: {
        type: 'string',
        description: 'Search query to find cards',
      },
      types: {
        type: 'array',
        items: { 
          type: 'string',
          enum: ['text', 'link', 'image', 'video', 'audio', 'document']
        },
        description: 'Filter by card types',
      },
      favoritesOnly: {
        type: 'boolean',
        description: 'Only return favorited cards',
      },
      showTrashOnly: {
        type: 'boolean',
        description: 'Only show deleted cards',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of cards to return (default: 50)',
      },
    },
    async ({ searchQuery, types, favoritesOnly, showTrashOnly, limit }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        const cards = await convex.query(api.cards.searchCards, {
          searchQuery,
          types,
          favoritesOnly,
          showTrashOnly,
          limit: limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${cards.length} cards:\n\n${JSON.stringify(cards, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to search cards: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Card Collection Tools
  server.tool(
    'teak_list_cards',
    'Get a paginated list of cards with optional filters',
    {
      type: {
        type: 'string',
        description: 'Filter by card type',
        enum: ['text', 'link', 'image', 'video', 'audio', 'document'],
      },
      favoritesOnly: {
        type: 'boolean',
        description: 'Only return favorited cards',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of cards to return (default: 50)',
      },
    },
    async ({ type, favoritesOnly, limit }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        const cards = await convex.query(api.cards.getCards, {
          type,
          favoritesOnly,
          limit: limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Retrieved ${cards.length} cards:\n\n${JSON.stringify(cards, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to list cards: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'teak_get_favorites',
    'Retrieve all favorited cards',
    {
      limit: {
        type: 'number',
        description: 'Maximum number of cards to return (default: 50)',
      },
    },
    async ({ limit }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        const cards = await convex.query(api.cards.getCards, {
          favoritesOnly: true,
          limit: limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Retrieved ${cards.length} favorite cards:\n\n${JSON.stringify(cards, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get favorites: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'teak_get_trash',
    'Access deleted cards in trash',
    {
      limit: {
        type: 'number',
        description: 'Maximum number of cards to return (default: 50)',
      },
    },
    async ({ limit }, { authInfo }) => {
      try {
        const convex = await getAuthenticatedConvexClient(authInfo);
        const cards = await convex.query(api.cards.searchCards, {
          showTrashOnly: true,
          limit: limit || 50,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Retrieved ${cards.length} deleted cards:\n\n${JSON.stringify(cards, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get trash: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
});

const authHandler = withMcpAuth(
  handler,
  async (_, token) => {
    console.log('MCP auth called with token:', token ? 'present' : 'missing');
    try {
      const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
      const result = await verifyClerkToken(clerkAuth, token);
      console.log('Auth verification result:', result);
      return result;
    } catch (error) {
      console.error('Auth verification error:', error);
      throw error;
    }
  },
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  }
);

// Add request logging
async function handleRequest(request: Request) {
  console.log('MCP request received:', {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
  });
  
  return authHandler(request);
}

export { handleRequest as GET, handleRequest as POST };