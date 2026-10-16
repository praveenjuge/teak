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

/** One line beside the toast's Upgrade button, which says the rest. */
export const CARD_LIMIT_TOAST_MESSAGE = "Free card limit reached";

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
 * Success variant for a completed upload queue. Auto-dismisses quietly after
 * a short confirmation window; error/actionable upload toasts stay sticky.
 */
export const UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS: ExternalToast = {
  duration: 4000,
  closeButton: false,
  dismissible: true,
};

/**
 * Upload result that needs no action, such as an upload where files over the
 * per-upload cap were skipped. Long enough to read, then dismisses itself.
 */
export const UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS: ExternalToast = {
  duration: 6000,
  closeButton: true,
  dismissible: true,
};

export const UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS: ExternalToast = {
  ...MANUAL_CLOSE_TOAST_OPTIONS,
};
