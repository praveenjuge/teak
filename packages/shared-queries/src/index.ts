// Query client configuration

// Core query hooks
export {
  useAdminStats,
  useAiSettings,
  useCard,
  useCardStats,
  useCards,
  useCreateCard,
  useCreateCardWithFile,
  useDeleteCard,
  useJobs,
  useRefetchOgImages,
  useRefetchScreenshots,
  useRefreshAiData,
  useSearchCards,
  useTags,
  useUpdateAiSettings,
  useUpdateCard,
  useUsers,
} from './hooks';
export {
  createQueryClient,
  mobileQueryClient,
  type QueryClientOptions,
  webQueryClient,
} from './query-client';
// Types
export type {
  ApiClient,
  CreateCardData,
  CreateCardWithFileData,
  UpdateCardData,
  UseCardsParams,
  UseSearchCardsParams,
} from './types';
// Utilities
export {
  addCardToQueries,
  createOptimisticCard,
  createOptimisticFileCard,
  detectCardTypeFromFile,
  removeCardFromQueries,
  restoreQueries,
  snapshotQueries,
  updateCardInQueries,
  updateCardsQueryData,
} from './utils';
