export type ContextMenuAction = 'saveUrl' | 'saveImage' | 'saveText';

export interface ContextMenuMessage {
  action: ContextMenuAction;
  data: {
    url?: string;
    imageUrl?: string;
    selectedText?: string;
    pageTitle?: string;
  };
}

export interface SaveResponse {
  success: boolean;
  error?: string;
  cardId?: string;
}

export type NotificationType = 'success' | 'error' | 'loading';

export interface NotificationData {
  type: NotificationType;
  message: string;
  duration?: number;
}