import type { ExternalToast } from "sonner";

export const TOAST_IDS = {
  copyFeedback: "copy-feedback",
  cardSave: "card-save",
  cardLimit: "card-limit",
  notesSave: "notes-save",
  bulkDelete: "bulk-delete",
  customerPortal: "customer-portal",
  checkoutOpen: "checkout-open",
  apiKeyCreate: "api-key-create",
  uploadQueue: "upload-queue",
  language: "language",
  offline: "offline",
} as const;

export const MANUAL_CLOSE_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: true,
  dismissible: true,
};

export const UNDO_TOAST_DURATION_MS = 10_000;
