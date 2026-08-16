/**
 * Client-side registry for freshly uploaded image/video previews.
 *
 * While the server pipeline (classification, metadata, renderables) is still
 * running, a card has no thumbnail yet. We keep a short-lived blob URL for the
 * local file so the card renders instantly instead of downloading the full
 * original. Once a real thumbnail exists the registry entry is revoked.
 */

const UPLOAD_PREVIEW_TTL_MS = 10 * 60 * 1000;

interface UploadPreviewEntry {
  url: string;
  expiresAt: number;
}

type Listener = () => void;

const previews = new Map<string, UploadPreviewEntry>();
const listeners = new Set<Listener>();

const isBrowser = () =>
  typeof window !== "undefined" &&
  typeof URL !== "undefined" &&
  typeof URL.createObjectURL === "function" &&
  typeof URL.revokeObjectURL === "function";

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const setUploadPreview = (cardId: string, objectUrl: string) => {
  if (!isBrowser()) {
    return;
  }
  previews.set(cardId, {
    url: objectUrl,
    expiresAt: Date.now() + UPLOAD_PREVIEW_TTL_MS,
  });
  notify();
};

export const getUploadPreview = (cardId: string): string | undefined => {
  if (!isBrowser()) {
    return undefined;
  }
  const entry = previews.get(cardId);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    previews.delete(cardId);
    URL.revokeObjectURL(entry.url);
    return undefined;
  }
  return entry.url;
};

export const clearUploadPreview = (cardId: string) => {
  if (!isBrowser()) {
    return;
  }
  const entry = previews.get(cardId);
  if (entry) {
    URL.revokeObjectURL(entry.url);
    previews.delete(cardId);
    notify();
  }
};

export const clearAllUploadPreviews = () => {
  if (!isBrowser()) {
    return;
  }
  for (const entry of previews.values()) {
    URL.revokeObjectURL(entry.url);
  }
  previews.clear();
  notify();
};

export const subscribeUploadPreviews = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
