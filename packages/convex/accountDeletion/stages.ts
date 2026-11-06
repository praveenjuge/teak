import { ConvexError } from "convex/values";

// A state's stored `stage` is its index here, so entries never move. Billing
// closes first so a stalled stage never charges a deleted owner; analytics
// goes last so no earlier stage can record another event for the owner.
// Stages 1 and 2 used to revoke WorkOS sessions and authorized Connect apps.
// Deleting the WorkOS user (`workosUser`) revokes both, and Teak denies a
// deleting owner from stage 0, so they now advance without doing anything.
// They keep their places so later stages keep their numbers.
export const ACCOUNT_DELETION_STAGES = [
  "accessAndBilling",
  "retiredProviderSessions",
  "retiredAuthorizedApps",
  "accountData",
  "workosUser",
  "retainedRecordsAndAnalytics",
] as const;

export type AccountDeletionStage = (typeof ACCOUNT_DELETION_STAGES)[number];

export const accountDeletionStage = (name: AccountDeletionStage): number =>
  ACCOUNT_DELETION_STAGES.indexOf(name);

export const ACCOUNT_DELETION_STAGES_DONE = ACCOUNT_DELETION_STAGES.length;

export const ACCOUNT_DELETION_PROGRESS_GRACE_MS = 60_000;

/**
 * Failures a deletion records under a reason of its own, by the code a
 * deletion step throws for each. An operator has to look at a storage
 * source that changed; the other two clear on a later attempt.
 *
 * A step throws one with `accountDeletionFailure`: a `ConvexError` whose
 * data is the code, so the workflow RPC gateway hands it to the Core Worker
 * as the error's `code`. A Workflow step that gives up returns its error
 * with the message alone, so the message is the code too, followed by any
 * detail after a colon.
 */
export const ACCOUNT_DELETION_FAILURES = {
  deletion_storage_source_changed: "storage_source_changed",
  deletion_object_write_pending: "object_write_pending",
  deletion_posthog_failed: "analytics_deletion_failed",
} as const;

export type AccountDeletionFailureCode = keyof typeof ACCOUNT_DELETION_FAILURES;
export type AccountDeletionFailureReason =
  (typeof ACCOUNT_DELETION_FAILURES)[AccountDeletionFailureCode];

export const ACCOUNT_DELETION_FAILURE_REASONS = Object.values(
  ACCOUNT_DELETION_FAILURES
) as AccountDeletionFailureReason[];

export const accountDeletionFailure = (
  code: AccountDeletionFailureCode,
  detail?: string
): ConvexError<string> =>
  new ConvexError(detail === undefined ? code : `${code}:${detail}`);

const leadingCode = (value: unknown): string | undefined =>
  typeof value === "string" ? value.split(":", 1)[0] : undefined;

const isFailureCode = (
  value: string | undefined
): value is AccountDeletionFailureCode =>
  value !== undefined && Object.keys(ACCOUNT_DELETION_FAILURES).includes(value);

/** The reason a deletion failed with, when it is one with its own code. */
export const deletionFailureReason = (
  error: unknown
): AccountDeletionFailureReason | undefined => {
  const code =
    error instanceof ConvexError
      ? leadingCode(error.data)
      : (leadingCode((error as { code?: unknown } | null)?.code) ??
        (error instanceof Error ? leadingCode(error.message) : undefined));
  return isFailureCode(code) ? ACCOUNT_DELETION_FAILURES[code] : undefined;
};

/** What a deletion's state records when a stage fails. */
export const accountDeletionFailureCode = (
  stage: number,
  reason?: AccountDeletionFailureReason
) => `account_deletion_stage_${stage}_${reason ?? "failed"}`;

/**
 * Failures another attempt can't fix: the storage being deleted changed
 * under the run. An operator resolves it, then runs
 * `accountDeletionJobs:retry`.
 */
export const accountDeletionNeedsOperator = (failureCode?: string): boolean =>
  failureCode?.endsWith(
    `_${"storage_source_changed" satisfies AccountDeletionFailureReason}`
  ) === true;
