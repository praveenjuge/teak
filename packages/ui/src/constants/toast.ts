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
} as const;

export const MANUAL_CLOSE_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: true,
  dismissible: true,
};

export const AUTH_STICKY_TOAST_OPTIONS: ExternalToast =
  MANUAL_CLOSE_TOAST_OPTIONS;

/**
 * Loading toast shown while an upload queue is draining.
 *
 * Cannot be closed and does not cancel the upload. Duration is infinite so
 * sonner doesn't auto-dismiss mid-upload; we replace this toast with a
 * success/failure variant once the queue finishes.
 */
export const UPLOAD_QUEUE_LOADING_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: false,
  dismissible: false,
};

/**
 * Success variant for a completed upload queue. Auto-dismisses but still
 * exposes a close affordance so users can clear it manually.
 */
export const UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS: ExternalToast = {
  closeButton: true,
  dismissible: true,
};

/**
 * Critical/actionable upload result — stays pinned until closed.
 *
 * Used for folder rejection, offline drops, too-many-files, card/rate limits,
 * total failure and partial failure. Shares the manual-close semantics from
 * the existing constants but keeps its own name so we can tune copy/styling
 * for upload-specific flows without affecting auth toasts.
 */
export const UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS: ExternalToast = {
  ...MANUAL_CLOSE_TOAST_OPTIONS,
};
