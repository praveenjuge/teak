import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiClient,
  CreateCardData,
  CreateCardWithFileData,
  UpdateCardData,
  UseCardsParams,
  UseSearchCardsParams,
} from './types';
import {
  addCardToQueries,
  createOptimisticCard,
  createOptimisticFileCard,
  removeCardFromQueries,
  restoreQueries,
  snapshotQueries,
  updateCardInQueries,
} from './utils';

export function useCards(apiClient: ApiClient, params?: UseCardsParams) {
  return useQuery({
    queryKey: ['cards', params],
    queryFn: () => apiClient.getCards(params),
  });
}

export function useCard(apiClient: ApiClient, id: number) {
  return useQuery({
    queryKey: ['cards', id],
    queryFn: () => apiClient.getCard(id),
    enabled: !!id,
  });
}

export function useCreateCard(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cardData: CreateCardData) => apiClient.createCard(cardData),
    onMutate: async (newCard) => {
      await queryClient.cancelQueries({ queryKey: ['cards'] });

      const previousQueries = snapshotQueries(queryClient, ['cards']);
      const optimisticCard = createOptimisticCard(newCard);

      addCardToQueries(queryClient, optimisticCard);

      return { previousQueries };
    },
    onError: (err, _, context) => {
      if (context?.previousQueries) {
        restoreQueries(queryClient, context.previousQueries);
      }
      console.error('Failed to save card:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useUpdateCard(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCardData }) =>
      apiClient.updateCard(id, data),
    onSuccess: (updatedCard) => {
      queryClient.setQueryData(['cards', updatedCard.id], updatedCard);
      updateCardInQueries(queryClient, updatedCard);
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useDeleteCard(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiClient.deleteCard(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: ['cards'] });

      const previousQueries = snapshotQueries(queryClient, ['cards']);

      removeCardFromQueries(queryClient, deletedId);

      return { previousQueries };
    },
    onError: (err, _, context) => {
      if (context?.previousQueries) {
        restoreQueries(queryClient, context.previousQueries);
      }
      console.error('Failed to delete card:', err);
    },
    onSuccess: (_, deletedId) => {
      queryClient.removeQueries({ queryKey: ['cards', deletedId] });
    },
  });
}

export function useSearchCards(
  apiClient: ApiClient,
  query: string,
  params?: UseSearchCardsParams
) {
  return useQuery({
    queryKey: ['cards', 'search', query, params],
    queryFn: () => apiClient.searchCards(query, params),
    enabled: !!query.trim(),
  });
}

export function useCardStats(apiClient: ApiClient) {
  return useQuery({
    queryKey: ['cards', 'stats'],
    queryFn: () => apiClient.getCardStats(),
  });
}

export function useCreateCardWithFile(
  apiClient: ApiClient,
  onUploadProgress?: (progress: number) => void
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, cardData }: CreateCardWithFileData) =>
      apiClient.createCardWithFile(file, cardData, onUploadProgress),
    onMutate: async ({ file, cardData }) => {
      await queryClient.cancelQueries({ queryKey: ['cards'] });

      const previousQueries = snapshotQueries(queryClient, ['cards']);
      const optimisticCard = createOptimisticFileCard(file, cardData);

      addCardToQueries(queryClient, optimisticCard);

      return { previousQueries };
    },
    onError: (err, _, context) => {
      if (context?.previousQueries) {
        restoreQueries(queryClient, context.previousQueries);
      }
      console.error('Failed to upload file:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

// Job hooks
export function useJobs(apiClient: ApiClient) {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => apiClient.getJobs(),
    refetchInterval: 5000, // Refetch every 5 seconds to show job progress
  });
}

export function useRefetchOgImages(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.createRefetchOgImagesJob(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useRefetchScreenshots(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.createRefetchScreenshotsJob(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

export function useRefreshAiData(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.createRefreshAiDataJob(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });
}

// Admin hooks
export function useAdminStats(apiClient: ApiClient) {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiClient.getAdminStats(),
    refetchInterval: 30_000, // Refetch every 30 seconds for live stats
  });
}

export function useUsers(apiClient: ApiClient) {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.getUsers(),
  });
}

// AI Settings hooks
export function useAiSettings(apiClient: ApiClient) {
  return useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => apiClient.getAiSettings(),
  });
}

export function useUpdateAiSettings(apiClient: ApiClient) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Record<string, any>) =>
      apiClient.updateAiSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
}
