import { useSyncExternalStore } from "react";
import {
  setUploadPreview,
  clearUploadPreview,
  getUploadPreview,
  subscribeUploadPreviews,
} from "./uploadPreviewStore";

/**
 * Subscribe to the instant preview blob URL for a freshly uploaded card.
 * Returns undefined once the card has a real server thumbnail.
 */
export const useUploadPreview = (cardId: string): string | undefined => {
  const subscribe = subscribeUploadPreviews;
  const getSnapshot = () => getUploadPreview(cardId);

  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
};

export { clearUploadPreview };
export { setUploadPreview };
