import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import type { ContextMenuAction, SaveResponse, NotificationData } from "../types/contextMenu";


export const useContextMenuSave = () => {
  const createCard = useMutation(api.cards.createCard);
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);

  const saveUrl = async (url: string): Promise<SaveResponse> => {
    try {
      const cardId = await createCard({
        content: url,
        type: "link",
        url: url,
        metadata: {},
      });

      return {
        success: true,
        cardId: cardId
      };
    } catch (error) {
      console.error("Failed to save URL:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save URL"
      };
    }
  };

  const saveText = async (text: string, sourceUrl?: string): Promise<SaveResponse> => {
    try {
      const cardId = await createCard({
        content: text,
        type: "text",
        url: sourceUrl,
        metadata: {},
      });

      return {
        success: true,
        cardId: cardId
      };
    } catch (error) {
      console.error("Failed to save text:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save text"
      };
    }
  };

  const saveImage = async (imageUrl: string, sourceUrl?: string): Promise<SaveResponse> => {
    try {
      // Use background script to fetch image as data URL (bypasses CORS restrictions)
      const imageResponse = await new Promise<{
        success: boolean;
        data?: { dataUrl: string; mimeType: string; size: number };
        error?: string;
      }>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'FETCH_IMAGE', imageUrl },
            (response) => {
              // Check for extension context errors
              if (chrome.runtime.lastError) {
                resolve({
                  success: false,
                  error: `Extension error: ${chrome.runtime.lastError.message}`
                });
                return;
              }
              resolve(response || { success: false, error: 'No response from background script' });
            }
          );
        } catch (error) {
          resolve({
            success: false,
            error: `Failed to communicate with background script: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      });

      if (!imageResponse.success || !imageResponse.data) {
        throw new Error(imageResponse.error || 'Failed to fetch image');
      }

      const { dataUrl, mimeType } = imageResponse.data;
      
      // Convert data URL back to blob for upload
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      // Generate a filename from the URL or use a default
      const urlParts = imageUrl.split('/');
      let fileName = urlParts[urlParts.length - 1] || `image_${Date.now()}`;
      
      // Add extension if missing
      if (!fileName.includes('.')) {
        const ext = mimeType.split('/')[1] || 'jpg';
        fileName += `.${ext}`;
      }

      // Generate upload URL
      const uploadUrl = await generateUploadUrl({
        fileName,
        fileType: mimeType,
      });

      // Upload the blob to Convex storage
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }

      const { storageId } = await uploadResponse.json();

      // Create metadata (server will extract file details and dimensions)
      const metadata = {
        fileName,
      };

      // Create card - server will auto-detect type and extract metadata
      const cardId = await createCard({
        content: fileName, // Use filename as content
        url: sourceUrl, // Use source URL if available
        fileId: storageId,
        metadata,
      });

      return {
        success: true,
        cardId: cardId
      };
    } catch (error) {
      console.error("Failed to save image:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save image"
      };
    }
  };

  const performSave = async (action: ContextMenuAction, data: any): Promise<SaveResponse> => {
    switch (action) {
      case 'saveUrl':
        return await saveUrl(data.url);
      
      case 'saveText':
        return await saveText(data.selectedText, data.url);
      
      case 'saveImage':
        return await saveImage(data.imageUrl, data.url);
      
      default:
        return {
          success: false,
          error: "Unknown action"
        };
    }
  };

  const createNotification = (type: 'success' | 'error' | 'loading', message: string): NotificationData => {
    return {
      type,
      message,
      duration: type === 'loading' ? undefined : 3000
    };
  };

  return {
    saveUrl,
    saveText,
    saveImage,
    performSave,
    createNotification
  };
};