// A state's stored `stage` is its index here, so entries never move. Billing
// closes first so a stalled stage never charges a deleted owner; analytics
// goes last so no earlier stage can record another event for the owner.
export const ACCOUNT_DELETION_STAGES = [
  "accessAndBilling",
  "providerSessions",
  "authorizedApps",
  "accountData",
  "workosUser",
  "retainedRecordsAndAnalytics",
] as const;

export type AccountDeletionStage = (typeof ACCOUNT_DELETION_STAGES)[number];

export const accountDeletionStage = (name: AccountDeletionStage): number =>
  ACCOUNT_DELETION_STAGES.indexOf(name);

export const ACCOUNT_DELETION_STAGES_DONE = ACCOUNT_DELETION_STAGES.length;

export const ACCOUNT_DELETION_PROGRESS_GRACE_MS = 60_000;

export const POSTHOG_DELETION_ERROR_PREFIX = "deletion_posthog_";

export function deletionFailureReason(
  error: unknown
):
  | "storage_source_changed"
  | "object_write_pending"
  | "analytics_deletion_failed"
  | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  if (error.message.includes(POSTHOG_DELETION_ERROR_PREFIX)) {
    return "analytics_deletion_failed";
  }
  if (error.message.includes("deletion_storage_source_changed")) {
    return "storage_source_changed";
  }
  if (error.message.includes("deletion_object_write_pending")) {
    return "object_write_pending";
  }
  return undefined;
}
