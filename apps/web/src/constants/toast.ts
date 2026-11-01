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
} as const;

export const MANUAL_CLOSE_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: true,
  dismissible: true,
};

export const UNDO_TOAST_DURATION_MS = 10_000;

export const AUTH_STICKY_TOAST_OPTIONS: ExternalToast =
  MANUAL_CLOSE_TOAST_OPTIONS;

export const UPLOAD_QUEUE_LOADING_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: false,
  dismissible: false,
};

export const UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS: ExternalToast = {
  duration: 4000,
  closeButton: false,
  dismissible: true,
};

export const UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS: ExternalToast = {
  duration: 6000,
  closeButton: true,
  dismissible: true,
};

export const UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS: ExternalToast = {
  ...MANUAL_CLOSE_TOAST_OPTIONS,
};
