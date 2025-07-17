import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Card } from '../api';
import { apiClient } from '../api';

// Define types locally for now
type CreateCardData = {
  type: Card['type'];
  data: Record<string, any>;
  metaInfo?: Record<string, any>;
};

type UseCardsParams = {
  limit?: number;
  offset?: number;
  search?: string;
  type?: string;
};

type UseSearchCardsParams = {
  limit?: number;
  offset?: number;
};

type UpdateCardData = {
  type?: Card['type'];
  data?: Record<string, any>;
  metaInfo?: Record<string, any>;
};

// Hook implementations
export function useCards(params?: UseCardsParams) {
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
    mutationFn: (cardData: CreateCardData) => apiClient.createCard(cardData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useUpdateCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCardData }) =>
      apiClient.updateCard(id, data),
    onSuccess: (updatedCard) => {
      queryClient.setQueryData(['cards', updatedCard.id], updatedCard);
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useDeleteCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiClient.deleteCard(id),
    onSuccess: (_, deletedId) => {
      queryClient.removeQueries({ queryKey: ['cards', deletedId] });
    },
  });
}

export function useSearchCards(query: string, params?: UseSearchCardsParams) {
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

export function useCreateCardWithFile(
  onUploadProgress?: (progress: number) => void
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, cardData }: { file: string; cardData?: any }) =>
      apiClient.createCardWithFile(file, cardData, onUploadProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

// Re-export with API client already bound for convenience
export const useBoundCards = (params?: UseCardsParams) => useCards(params);

export const useBoundCard = (id: number) => useCard(id);

export const useBoundCreateCard = () => useCreateCard();

export const useBoundCreateCardWithFile = (
  onUploadProgress?: (progress: number) => void
) => useCreateCardWithFile(onUploadProgress);

export const useBoundUpdateCard = () => useUpdateCard();

export const useBoundDeleteCard = () => useDeleteCard();

export const useBoundSearchCards = (
  query: string,
  params?: UseSearchCardsParams
) => useSearchCards(query, params);

export const useBoundCardStats = () => useCardStats();
