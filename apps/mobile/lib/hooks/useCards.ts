import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type Card, type CardsResponse } from '../api';

export function useCards(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  type?: Card['type'];
  sort?: 'created_at' | 'updated_at' | 'type';
  order?: 'asc' | 'desc';
}) {
  return useQuery({
    queryKey: ['cards', params],
    queryFn: () => apiClient.getCards(params),
  });
}

export function useCard(id: number) {
  return useQuery({
    queryKey: ['cards', id],
    queryFn: () => apiClient.getCard(id),
    enabled: !!id,
  });
}

export function useCreateCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cardData: {
      type: Card['type'];
      data: Record<string, any>;
      metaInfo?: Record<string, any>;
    }) => apiClient.createCard(cardData),
    onMutate: async (newCard) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['cards'] });

      // Snapshot the previous queries
      const previousQueries = queryClient.getQueriesData({
        queryKey: ['cards'],
      });

      // Optimistically update all cards queries
      queryClient.setQueriesData({ queryKey: ['cards'] }, (oldData: any) => {
        if (!(oldData && oldData.cards)) return oldData;

        const optimisticCard = {
          id: Date.now(), // Temporary ID
          ...newCard,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: 'current-user', // Will be replaced by server response
        };

        return {
          ...oldData,
          cards: [optimisticCard, ...oldData.cards],
          total: oldData.total + 1,
        };
      });

      // Return a context object with the snapshotted value
      return { previousQueries };
    },
    onError: (err, _, context) => {
      // If the mutation fails, restore all previous queries
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('Failed to save card:', err);
    },
    onSuccess: () => {
      // Invalidate and refetch to get the real data from server
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useUpdateCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { data?: Record<string, any>; metaInfo?: Record<string, any> };
    }) => apiClient.updateCard(id, data),
    onSuccess: (updatedCard) => {
      // Update the specific card in cache
      queryClient.setQueryData(['cards', updatedCard.id], updatedCard);
      // Invalidate cards list to refetch
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useDeleteCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiClient.deleteCard(id),
    onSuccess: (_, deletedId) => {
      // Remove the card from all cards queries
      queryClient.setQueriesData({ queryKey: ['cards'] }, (oldData: any) => {
        if (!(oldData && oldData.cards)) return oldData;

        return {
          ...oldData,
          cards: oldData.cards.filter((card: Card) => card.id !== deletedId),
          total: oldData.total - 1,
        };
      });
      // Remove the specific card query
      queryClient.removeQueries({ queryKey: ['cards', deletedId] });
    },
  });
}

export function useSearchCards(
  query: string,
  params?: {
    limit?: number;
    offset?: number;
    type?: Card['type'];
  }
) {
  return useQuery({
    queryKey: ['cards', 'search', query, params],
    queryFn: () => apiClient.searchCards(query, params),
    enabled: !!query.trim(),
  });
}

export function useCardStats() {
  return useQuery({
    queryKey: ['cards', 'stats'],
    queryFn: () => apiClient.getCardStats(),
  });
}
