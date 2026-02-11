import type { ExternalToast } from "sonner";

export const TOAST_IDS = {
  copyFeedback: "copy-feedback",
  cardSave: "card-save",
  notesSave: "notes-save",
  bulkDelete: "bulk-delete",
  customerPortal: "customer-portal",
  checkoutOpen: "checkout-open",
  apiKeyCreate: "api-key-create",
} as const;

export const AUTH_STICKY_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: true,
  dismissible: true,
};
