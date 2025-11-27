/**
 * Sentry Metrics utility for tracking application health and user behavior.
 *
 * Usage:
 *   import { metrics } from "@/lib/metrics";
 *   metrics.cardCreated("link");
 *   metrics.fileUploaded(1024 * 1024, "image/png", true);
 *   metrics.searchPerformed(3, ["link", "image"]);
 */

import * as Sentry from "@sentry/nextjs";

// ============================================================================
// Card Metrics
// ============================================================================

/**
 * Track card creation events
 */
export function cardCreated(cardType: string) {
  Sentry.metrics.count("card.created", 1, {
    attributes: { card_type: cardType },
  });
}

/**
 * Track card deletion events (soft delete)
 */
export function cardDeleted(cardType: string) {
  Sentry.metrics.count("card.deleted", 1, {
    attributes: { card_type: cardType },
  });
}

/**
 * Track card restoration events
 */
export function cardRestored(cardType: string) {
  Sentry.metrics.count("card.restored", 1, {
    attributes: { card_type: cardType },
  });
}

/**
 * Track permanent card deletion
 */
export function cardPermanentlyDeleted(cardType: string) {
  Sentry.metrics.count("card.permanently_deleted", 1, {
    attributes: { card_type: cardType },
  });
}

/**
 * Track card update events
 */
export function cardUpdated(cardType: string, field: string) {
  Sentry.metrics.count("card.updated", 1, {
    attributes: { card_type: cardType, field },
  });
}

/**
 * Track favorite toggling
 */
export function cardFavoriteToggled(cardType: string, isFavorite: boolean) {
  Sentry.metrics.count("card.favorite_toggled", 1, {
    attributes: {
      card_type: cardType,
      action: isFavorite ? "favorited" : "unfavorited",
    },
  });
}

// ============================================================================
// Authentication Metrics
// ============================================================================

/**
 * Track successful login events
 */
export function loginSuccess(method: "email" | "google") {
  Sentry.metrics.count("auth.login.success", 1, {
    attributes: { method },
  });
}

/**
 * Track failed login attempts
 */
export function loginFailed(method: "email" | "google", reason?: string) {
  Sentry.metrics.count("auth.login.failed", 1, {
    attributes: {
      method,
      reason: reason || "unknown",
    },
  });
}

/**
 * Track successful registrations
 */
export function registrationSuccess(method: "email" | "google") {
  Sentry.metrics.count("auth.registration.success", 1, {
    attributes: { method },
  });
}

/**
 * Track failed registration attempts
 */
export function registrationFailed(method: "email" | "google", reason?: string) {
  Sentry.metrics.count("auth.registration.failed", 1, {
    attributes: {
      method,
      reason: reason || "unknown",
    },
  });
}

/**
 * Track logout events
 */
export function logout() {
  Sentry.metrics.count("auth.logout", 1);
}

/**
 * Track password reset requests
 */
export function passwordResetRequested() {
  Sentry.metrics.count("auth.password_reset.requested", 1);
}

// ============================================================================
// File Upload Metrics
// ============================================================================

/**
 * Track file upload events
 */
export function fileUploaded(
  fileSize: number,
  mimeType: string,
  success: boolean
) {
  const fileCategory = getFileCategory(mimeType);

  Sentry.metrics.count("file.upload", 1, {
    attributes: {
      file_category: fileCategory,
      success: String(success),
    },
  });

  if (success) {
    Sentry.metrics.distribution("file.upload.size", fileSize, {
      unit: "byte",
      attributes: { file_category: fileCategory },
    });
  }
}

/**
 * Track file upload duration
 */
export function fileUploadDuration(durationMs: number, fileCategory: string) {
  Sentry.metrics.distribution("file.upload.duration", durationMs, {
    unit: "millisecond",
    attributes: { file_category: fileCategory },
  });
}

/**
 * Track audio recording events
 */
export function audioRecorded(durationSeconds: number, success: boolean) {
  Sentry.metrics.count("audio.recording", 1, {
    attributes: { success: String(success) },
  });

  if (success) {
    Sentry.metrics.distribution("audio.recording.duration", durationSeconds, {
      unit: "second",
    });
  }
}

// ============================================================================
// Search & Filter Metrics
// ============================================================================

/**
 * Track search performed
 */
export function searchPerformed(resultCount: number, filterTypes?: string[]) {
  Sentry.metrics.count("search.performed", 1, {
    attributes: {
      has_type_filter: String(filterTypes && filterTypes.length > 0),
      filter_count: String(filterTypes?.length || 0),
    },
  });

  Sentry.metrics.distribution("search.result_count", resultCount);
}

/**
 * Track filter usage
 */
export function filterApplied(
  filterType: "type" | "favorites" | "trash" | "keyword"
) {
  Sentry.metrics.count("filter.applied", 1, {
    attributes: { filter_type: filterType },
  });
}

// ============================================================================
// User Engagement Metrics
// ============================================================================

/**
 * Track modal opens
 */
export function modalOpened(modalType: "card" | "settings" | "upgrade") {
  Sentry.metrics.count("modal.opened", 1, {
    attributes: { modal_type: modalType },
  });
}

/**
 * Track drag and drop events
 */
export function dragDropPerformed(
  fileCount: number,
  success: boolean,
  reason?: string
) {
  Sentry.metrics.count("drag_drop.performed", 1, {
    attributes: {
      success: String(success),
      file_count: String(fileCount),
      ...(reason && { failure_reason: reason }),
    },
  });
}

/**
 * Track feature usage
 */
export function featureUsed(
  feature:
    | "voice_recording"
    | "file_upload"
    | "quick_add"
    | "bulk_action"
    | "export"
) {
  Sentry.metrics.count("feature.used", 1, {
    attributes: { feature },
  });
}

// ============================================================================
// Billing Metrics
// ============================================================================

/**
 * Track upgrade prompts shown
 */
export function upgradePromptShown(trigger: string) {
  Sentry.metrics.count("billing.upgrade_prompt_shown", 1, {
    attributes: { trigger },
  });
}

/**
 * Track checkout initiated
 */
export function checkoutInitiated() {
  Sentry.metrics.count("billing.checkout_initiated", 1);
}

/**
 * Track card limit reached events
 */
export function cardLimitReached(currentCount: number) {
  Sentry.metrics.count("billing.card_limit_reached", 1);
  Sentry.metrics.gauge("billing.cards_at_limit", currentCount);
}

// ============================================================================
// Performance Metrics
// ============================================================================

/**
 * Track page load performance
 */
export function pageLoaded(pageName: string, loadTimeMs: number) {
  Sentry.metrics.distribution("page.load_time", loadTimeMs, {
    unit: "millisecond",
    attributes: { page: pageName },
  });
}

/**
 * Track API/mutation response times
 */
export function operationDuration(
  operation: string,
  durationMs: number,
  success: boolean
) {
  Sentry.metrics.distribution("operation.duration", durationMs, {
    unit: "millisecond",
    attributes: {
      operation,
      success: String(success),
    },
  });
}

// ============================================================================
// Error Metrics
// ============================================================================

/**
 * Track client-side errors by category
 */
export function errorOccurred(
  category: "api" | "upload" | "auth" | "ui" | "unknown",
  errorCode?: string
) {
  Sentry.metrics.count("error.occurred", 1, {
    attributes: {
      category,
      ...(errorCode && { error_code: errorCode }),
    },
  });
}

/**
 * Track rate limit hits
 */
export function rateLimitHit(operation: string) {
  Sentry.metrics.count("rate_limit.hit", 1, {
    attributes: { operation },
  });
}

// ============================================================================
// Session Metrics
// ============================================================================

/**
 * Track active cards count (gauge)
 */
export function setActiveCardsCount(count: number, isPremium: boolean) {
  Sentry.metrics.gauge("user.active_cards", count, {
    attributes: { is_premium: String(isPremium) },
  });
}

/**
 * Track user session start
 */
export function sessionStarted(isPremium: boolean) {
  Sentry.metrics.count("session.started", 1, {
    attributes: { is_premium: String(isPremium) },
  });
}

// ============================================================================
// Helpers
// ============================================================================

function getFileCategory(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("pdf")) return "pdf";
  if (
    mimeType.includes("document") ||
    mimeType.includes("word") ||
    mimeType.includes("text")
  )
    return "document";
  return "other";
}

// ============================================================================
// Convenience export
// ============================================================================

export const metrics = {
  // Cards
  cardCreated,
  cardDeleted,
  cardRestored,
  cardPermanentlyDeleted,
  cardUpdated,
  cardFavoriteToggled,

  // Auth
  loginSuccess,
  loginFailed,
  registrationSuccess,
  registrationFailed,
  logout,
  passwordResetRequested,

  // Files
  fileUploaded,
  fileUploadDuration,
  audioRecorded,

  // Search
  searchPerformed,
  filterApplied,

  // Engagement
  modalOpened,
  dragDropPerformed,
  featureUsed,

  // Billing
  upgradePromptShown,
  checkoutInitiated,
  cardLimitReached,

  // Performance
  pageLoaded,
  operationDuration,

  // Errors
  errorOccurred,
  rateLimitHit,

  // Session
  setActiveCardsCount,
  sessionStarted,
};
