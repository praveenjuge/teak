import type { QueryClient } from '@tanstack/react-query';
import type { Card, CardsResponse } from '@teak/shared-types';

export function updateCardsQueryData(
  queryClient: QueryClient,
  updater: (oldData: CardsResponse) => CardsResponse
) {
  queryClient.setQueriesData(
    { queryKey: ['cards'] },
    (oldData: CardsResponse | undefined) => {
      if (!oldData) {
        return oldData;
      }
      return updater(oldData);
    }
  );
}

export function addCardToQueries(queryClient: QueryClient, newCard: Card) {
  updateCardsQueryData(queryClient, (oldData) => ({
    ...oldData,
    cards: [newCard, ...oldData.cards],
    total: oldData.total + 1,
  }));
}

export function removeCardFromQueries(
  queryClient: QueryClient,
  cardId: number
) {
  updateCardsQueryData(queryClient, (oldData) => ({
    ...oldData,
    cards: oldData.cards.filter((card) => card.id !== cardId),
    total: oldData.total - 1,
  }));
}

export function updateCardInQueries(
  queryClient: QueryClient,
  updatedCard: Card
) {
  updateCardsQueryData(queryClient, (oldData) => ({
    ...oldData,
    cards: oldData.cards.map((card) =>
      card.id === updatedCard.id ? updatedCard : card
    ),
  }));
}

export function createOptimisticCard(cardData: {
  type: Card['type'];
  data: Record<string, any>;
  metaInfo?: Record<string, any>;
}): Card {
  return {
    id: Date.now(), // Temporary ID
    ...cardData,
    metaInfo: cardData.metaInfo || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: 'current-user', // Will be replaced by server response
  };
}

export function detectCardTypeFromFile(file: File): Card['type'] {
  if (file.type.startsWith('image/')) {
    return 'image';
  }
  if (file.type.startsWith('video/')) {
    return 'video';
  }
  if (file.type.startsWith('audio/')) {
    return 'audio';
  }
  return 'image'; // Default fallback
}

export function createOptimisticFileCard(
  file: File,
  cardData?: {
    type?: Card['type'];
    data?: Record<string, any>;
    metaInfo?: Record<string, any>;
  }
): Card {
  const detectedType = detectCardTypeFromFile(file);

  return {
    id: Date.now(), // Temporary ID
    type: cardData?.type || detectedType,
    data: {
      title: `Uploading ${file.name}...`,
      ...(detectedType === 'image' && {
        alt_text: `Uploading image: ${file.name}`,
      }),
      ...(detectedType === 'video' && { duration: 0 }),
      ...(detectedType === 'audio' && { duration: 0 }),
      ...cardData?.data,
    },
    metaInfo: {
      source: 'File Upload',
      uploading: true,
      fileName: file.name,
      fileSize: file.size,
      ...cardData?.metaInfo,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: 'current-user',
  };
}

export function snapshotQueries(queryClient: QueryClient, queryKey: any[]) {
  return queryClient.getQueriesData({ queryKey });
}

export function restoreQueries(
  queryClient: QueryClient,
  snapshot: [readonly unknown[], unknown][]
) {
  snapshot.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey as any[], data);
  });
}
