import { useMutation } from 'convex/react';
import { api } from '@teak/convex';

// Re-export Convex hooks for convenience
export { useQuery, useMutation } from 'convex/react';
export { api } from '@teak/convex';

export interface FileUploadConfig {
  onUploadProgress?: (progress: number) => void;
  onUploadError?: (error: Error) => void;
}

// Basic card operation hooks (from mobile)
export const useCreateCard = () => useMutation(api.cards.createCard);
export const useUpdateCard = () => useMutation(api.cards.updateCardField);
export const useDeleteCard = () => useMutation(api.cards.deleteCard);
export const useToggleFavorite = () => useMutation(api.cards.toggleFavorite);
export const useRestoreCard = () => useMutation(api.cards.restoreCard);
export const usePermanentDeleteCard = () => useMutation(api.cards.permanentDeleteCard);
export const useGenerateUploadUrl = () => useMutation(api.cards.generateUploadUrl);

// File upload with configurable behavior
export function useCreateCardWithFile(config: FileUploadConfig = {}) {
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);
  const createCard = useMutation(api.cards.createCard);
  
  return {
    async uploadFile(fileUri: string, fileName: string, mimeType: string) {
      try {
        const uploadUrl = await generateUploadUrl({ fileName, fileType: mimeType });
        const response = await fetch(fileUri);
        const blob = await response.blob();
        
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          body: blob,
        });
        
        if (!uploadResponse.ok) {
          throw new Error('Failed to upload file');
        }
        
        const { storageId } = await uploadResponse.json();
        return storageId;
      } catch (error) {
        config.onUploadError?.(error as Error);
        throw error;
      }
    },
    createCard
  };
}