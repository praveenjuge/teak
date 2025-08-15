import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import type { ContextMenuAction, SaveResponse, NotificationData } from "../types/contextMenu";

export const useContextMenuSave = () => {
  const createCard = useMutation(api.cards.createCard);

  const saveUrl = async (url: string, pageTitle?: string): Promise<SaveResponse> => {
    try {
      const cardId = await createCard({
        content: url,
        type: "link",
        url: url,
        metadata: {
          linkTitle: pageTitle || undefined,
          linkDescription: undefined,
          linkImage: undefined,
        },
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
      const cardId = await createCard({
        content: imageUrl,
        type: "image",
        url: sourceUrl || imageUrl, // Use source URL if available, otherwise use image URL
        metadata: {},
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
        return await saveUrl(data.url, data.pageTitle);
      
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